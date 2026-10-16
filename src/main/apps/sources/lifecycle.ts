import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ENVELOPE_SCHEMA,
  T0_DECLARATIVE_DISCLOSURE,
  type AddSourceResult,
  type ApplyUpdateResult,
  type ConsentPayload,
  type ConsentRecord,
  type InstallExtensionResult,
  type ManifestDiff,
  type MiniAppSourceInstallView,
  type MiniAppSourceRecord,
  type MiniAppSourceView,
  type MiniAppSourcesState,
  type RestoreExtensionResult,
  type SourceCandidate,
  type SourceInstallRecord,
  type SourceSyncResult,
  type UpdateState,
} from '@shared/app-pack';
import { projectEnvelope } from '@shared/app-pack/mapping';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import type { ImportMiniAppResult, MiniAppSetEnabledResult } from '@shared/app-pack';
import { validateSourceDescriptor, type ValidatedSourceDescriptor } from './descriptor';
import { GitTransport, GitTransportError, type ResolvedRef } from './transport';

const MANIFEST_FILE = 'manifest.json';
const MANIFEST_MAX_BYTES = 524_288;

export interface ExtensionSourcesDeps {
  /**
   * Fresh COPIES of the persisted settings slices — the service mutates
   * the returned arrays element-wise and persists them explicitly; the
   * live config objects are never handed out.
   */
  miniApps(): {
    sources: MiniAppSourceRecord[];
    sourceInstalls: SourceInstallRecord[];
    packs: { manifest: unknown; enabled: boolean; error?: string }[];
  };
  updateMiniApps(patch: { sources?: MiniAppSourceRecord[]; sourceInstalls?: SourceInstallRecord[] }): Promise<void>;
  registry: {
    importManifest(json: string, origin: { kind: 'imported'; path?: string; importedAt?: number }): Promise<ImportMiniAppResult>;
    setEnabled(id: string, enabled: boolean): Promise<MiniAppSetEnabledResult>;
  };
  transport: GitTransport;
  /** <userData>/mini-apps — the content-addressed store root. */
  contentRoot(): string;
  secretStore: {
    get(slot: string): Promise<string | null>;
    set(slot: string, value: string): Promise<void>;
  };
  newId(): string;
  now(): number;
  sha256(input: string): string;
}

type LifecycleFailure = { code: string; detail: string };

/**
 * The family sources pipeline (plan 32 Phase 8 — the TS adoption of the
 * Phase-3 career reference semantics against the same vendored schemas):
 * one pipeline for git (https) and local file-path sources — resolve →
 * shallow fetch → manifest discovery (root + one level) → envelope
 * schema validation → host-profile mapping/compat → per-extension
 * consent → pinned, content-addressed install. Updates are pin-aware
 * and consent-aware (D15/D22): digest drift is a loud failure, capability
 * growth re-consents, and since desktop imports only T0 data packs a
 * byte-identical-manifest data diff is the ONLY auto-apply window —
 * there is no code auto-apply path at all.
 */
export class ExtensionSourcesService {
  constructor(private readonly deps: ExtensionSourcesDeps) {}

  // ------------------------------------------------------------- sources

  async listState(): Promise<MiniAppSourcesState> {
    return {
      sources: this.sources().map((source) => this.sourceView(source)),
      installs: this.installs().map((install) => this.installView(install)),
    };
  }

  async addSource(doc: unknown, secretValues?: Record<string, string>): Promise<AddSourceResult> {
    const verdict = validateSourceDescriptor(doc);
    if (!verdict.ok) {
      return { ok: false, error: verdict.error };
    }
    const descriptor = verdict.descriptor;
    if (this.sources().some((source) => source.origin === descriptor.origin)) {
      return { ok: false, error: `Source already exists: ${descriptor.origin}` };
    }
    for (const [slot, value] of Object.entries(secretValues ?? {})) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
        return { ok: false, error: `Secret value for slot '${slot}' is malformed.` };
      }
      if (!credentialSlots(descriptor).includes(slot)) {
        return { ok: false, error: `Descriptor declares no credential slot '${slot}'.` };
      }
      await this.deps.secretStore.set(slot, value);
    }
    const record: MiniAppSourceRecord = {
      id: this.deps.newId(),
      kind: descriptor.kind,
      origin: descriptor.origin,
      descriptor: descriptor.document,
      status: 'stale',
      consecutiveFailures: 0,
      candidates: [],
    };
    await this.updateMiniApps({ sources: [...this.sources(), record] });
    return { ok: true, source: record };
  }

  async removeSource(sourceId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: 'Unknown source.' };
    }
    const installs = this.installs();
    for (let index = 0; index < installs.length; index += 1) {
      const install = installs[index];
      if (install.sourceId !== sourceId || install.parked) {
        continue;
      }
      installs[index] = {
        ...install,
        parked: { reason: 'source removed', at: this.deps.now() },
      };
      await this.deps.registry.setEnabled(install.extensionId, false);
    }
    await this.updateMiniApps({
      sources: this.sources().filter((entry) => entry.id !== sourceId),
      sourceInstalls: installs.map((install) => ({ ...install })),
    });
    return { ok: true };
  }

  async syncSource(sourceId: string): Promise<SourceSyncResult> {
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: { code: 'not-found', detail: 'Unknown source.' } };
    }
    const descriptor: ValidatedSourceDescriptor = {
      kind: source.kind,
      origin: source.origin,
      document: source.descriptor,
      subpath: typeof source.descriptor.subpath === 'string' ? source.descriptor.subpath : '',
    };
    const candidates: SourceCandidate[] = [];
    try {
      await this.fetchTree(descriptor, async (tree, resolved) => {
        for (const found of await discoverManifests(tree, descriptor.subpath)) {
          const projection = projectEnvelope(found.manifest as Record<string, unknown>);
          const digest = projection.ok ? this.deps.sha256(JSON.stringify(projection.manifest)) : '';
          candidates.push({
            extensionId: found.extensionId,
            subpath: found.subpath,
            digest,
            ref: resolved.ref,
            compatible: projection.ok,
            ...(projection.ok ? {} : { reason: projection.reason }),
            ...(projection.ok && projection.manifest.configSchema !== undefined ? { configSchema: projection.manifest.configSchema } : {}),
            consent: this.consentPayload(found.manifest as Record<string, unknown>, digest, found.subpath),
          });
        }
      });
    } catch (error) {
      const failure = toFailure(error);
      await this.updateMiniApps({
        sources: this.sources().map((entry) =>
          entry.id === sourceId
            ? { ...entry, status: 'failing', error: `${failure.code}: ${failure.detail}`, consecutiveFailures: entry.consecutiveFailures + 1, lastCheckedAt: this.deps.now() }
            : entry
        ),
      });
      return { ok: false, error: failure };
    }
    if (candidates.length === 0) {
      const error = 'invalid: no extension manifests found (root + one level scanned)';
      await this.updateMiniApps({
        sources: this.sources().map((entry) =>
          entry.id === sourceId
            ? { ...entry, status: 'failing', error, consecutiveFailures: entry.consecutiveFailures + 1, lastCheckedAt: this.deps.now() }
            : entry
        ),
      });
      return { ok: false, error: { code: 'invalid', detail: 'no extension manifests found (root + one level scanned)' } };
    }
    const { installs, reports, driftError } = this.checkUpdates(sourceId, candidates);
    await this.updateMiniApps({
      sources: this.sources().map((entry) =>
        entry.id === sourceId
          ? {
              ...entry,
              candidates,
              status: driftError !== null ? 'degraded' : 'ok',
              error: driftError ?? undefined,
              consecutiveFailures: 0,
              lastCheckedAt: this.deps.now(),
              lastSuccessAt: this.deps.now(),
            }
          : entry
      ),
      sourceInstalls: installs,
    });
    return {
      ok: true,
      resolvedRef: candidates[0]?.ref ?? null,
      candidates,
      updates: reports,
    };
  }

  // ------------------------------------------------------------- consent

  private consentPayload(envelope: Record<string, unknown>, digest: string, subpath: string): ConsentPayload {
    return {
      extensionId: String(envelope.id ?? ''),
      version: String(envelope.version ?? ''),
      subpath,
      digest,
      tier: 'T0',
      importClass: 'imported',
      originClass: 'imported',
      capabilities: Array.isArray(envelope.capabilities) ? (envelope.capabilities as string[]) : [],
      provenance: {
        author: optionalString(envelope.author),
        license: optionalString(envelope.license),
        repository: optionalString(envelope.repository),
        description: optionalString(envelope.description),
      },
      disclosure: T0_DECLARATIVE_DISCLOSURE,
    };
  }

  async installExtension(sourceId: string, extensionId: string, consent: boolean): Promise<InstallExtensionResult> {
    if (!consent) {
      return { ok: false, error: 'Consent is required before any install of imported extensions (D7).' };
    }
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: 'Unknown source.' };
    }
    const candidate = source.candidates.find((entry) => entry.extensionId === extensionId);
    if (!candidate) {
      return { ok: false, error: `Extension '${extensionId}' is not offered by this source — run Check for updates.` };
    }
    const descriptor = this.descriptorOf(source);
    let hit: { manifest: Record<string, unknown>; digest: string; ref: string } | null = null;
    try {
      hit = await this.refetchCandidate(descriptor, extensionId);
    } catch (error) {
      return { ok: false, error: toFailureText(error) };
    }
    if (hit === null) {
      return { ok: false, error: `Extension '${extensionId}' disappeared from the source — re-run Check for updates.` };
    }
    if (hit.digest !== candidate.digest) {
      return {
        ok: false,
        error: 'The source moved since the consent was shown — the content no longer matches the digest you consented to. Re-check the source and re-consent.',
      };
    }
    return this.landInstall(source, extensionId, hit.manifest, hit.digest, hit.ref, candidate.subpath, false);
  }

  /** Re-fetch + re-discover + project one extension (the pin discipline: land exactly what was consented). */
  private async refetchCandidate(
    descriptor: ValidatedSourceDescriptor,
    extensionId: string
  ): Promise<{ manifest: Record<string, unknown>; digest: string; ref: string } | null> {
    const hits: { manifest: Record<string, unknown>; digest: string; ref: string }[] = [];
    await this.fetchTree(descriptor, async (tree, resolved) => {
      for (const found of await discoverManifests(tree, descriptor.subpath)) {
        if (found.extensionId !== extensionId) {
          continue;
        }
        const projection = projectEnvelope(found.manifest as Record<string, unknown>);
        if (!projection.ok) {
          throw new GitTransportError('invalid', `the extension is not hostable: ${projection.reason}`);
        }
        hits.push({ manifest: projection.manifest, digest: this.deps.sha256(JSON.stringify(projection.manifest)), ref: resolved.ref });
      }
    });
    return hits[0] ?? null;
  }

  // ------------------------------------------------------------- updates

  private checkUpdates(
    sourceId: string,
    candidates: SourceCandidate[]
  ): {
    installs: SourceInstallRecord[];
    reports: { extensionId: string; state: 'current' | UpdateState['state'] }[];
    driftError: string | null;
  } {
    const reports: { extensionId: string; state: 'current' | UpdateState['state'] }[] = [];
    let driftError: string | null = null;
    const installs = this.installs();
    for (let index = 0; index < installs.length; index += 1) {
      const install = installs[index];
      if (install.sourceId !== sourceId) {
        continue;
      }
      const candidate = candidates.find((entry) => entry.extensionId === install.extensionId);
      if (!candidate || !candidate.compatible) {
        installs[index] = { ...install, update: { state: 'absent-from-source' } };
        reports.push({ extensionId: install.extensionId, state: 'absent-from-source' });
        continue;
      }
      if (candidate.digest === install.digest) {
        if (candidate.ref && candidate.ref !== install.pinRef) {
          installs[index] = {
            ...install,
            pinRef: candidate.ref,
            refHistory: [...install.refHistory, { ref: candidate.ref, digest: candidate.digest, at: this.deps.now() }],
            update: undefined,
          };
        } else {
          installs[index] = { ...install, update: undefined };
        }
        reports.push({ extensionId: install.extensionId, state: 'current' });
        continue;
      }
      if (candidate.ref === install.pinRef) {
        driftError = `digest drift on ${install.extensionId} at pinned ref ${install.pinRef}`;
        installs[index] = {
          ...install,
          update: {
            state: 'digest-drift',
            ref: install.pinRef,
            expectedDigest: install.digest,
            foundDigest: candidate.digest,
            detail: 'pinned ref content changed — refusing to refetch; verify the source and re-consent explicitly',
          },
        };
        reports.push({ extensionId: install.extensionId, state: 'digest-drift' });
        continue;
      }
      const diff = manifestDiff(this.installedManifest(install.extensionId), {
        capabilities: candidate.consent.capabilities,
        configSchema: candidate.configSchema,
        version: candidate.consent.version,
      });
      installs[index] = {
        ...install,
        update: {
          state: 'available',
          ref: candidate.ref,
          digest: candidate.digest,
          manifestDiff: diff,
          requiresReconsent: diff.capabilitiesAdded.length > 0 || diff.configSchemaChanged,
        },
      };
      reports.push({ extensionId: install.extensionId, state: 'available' });
    }
    return { installs: installs.map((install) => ({ ...install })), reports, driftError };
  }

  async applyUpdate(sourceId: string, extensionId: string, consent: boolean): Promise<ApplyUpdateResult> {
    const install = this.installs().find((entry) => entry.extensionId === extensionId);
    if (!install || install.sourceId !== sourceId) {
      return { ok: false, error: 'Unknown installed extension for this source.' };
    }
    const update = install.update;
    if (!update || update.state !== 'available') {
      return { ok: false, error: `No update is available (state: ${update?.state ?? 'none'}).` };
    }
    if (update.requiresReconsent && !consent) {
      return {
        ok: false,
        error: 'This update grows the extension or changes its config schema — explicit re-consent is required (D15/D22).',
      };
    }
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: 'The source is gone — re-add it and re-consent.' };
    }
    const descriptor = this.descriptorOf(source);
    try {
      const hit = await this.refetchCandidate(descriptor, extensionId);
      if (hit === null) {
        return { ok: false, error: 'The update disappeared from the source — re-run Check for updates.' };
      }
      if (hit.digest !== update.digest) {
        return { ok: false, error: 'The source moved again mid-apply — re-run Check for updates; pins untouched.' };
      }
      return this.landInstall(source, extensionId, hit.manifest, hit.digest, hit.ref, install.subpath, true);
    } catch (error) {
      return { ok: false, error: toFailureText(error) };
    }
  }

  async restoreExtension(extensionId: string): Promise<RestoreExtensionResult> {
    const installs = this.installs();
    const index = installs.findIndex((entry) => entry.extensionId === extensionId);
    if (index < 0) {
      return { ok: false, error: 'Unknown installed extension.' };
    }
    const install = installs[index];
    if (!install.parked) {
      return { ok: false, error: 'The extension is not parked.' };
    }
    installs[index] = { ...install, parked: undefined };
    await this.updateMiniApps({ sourceInstalls: installs });
    return { ok: true, extensionId };
  }

  // -------------------------------------------------------------- landing

  private async landInstall(
    source: MiniAppSourceRecord,
    extensionId: string,
    manifest: Record<string, unknown>,
    digest: string,
    ref: string,
    subpath: string,
    reconsent: boolean
  ): Promise<InstallExtensionResult> {
    const contentPath = join(this.deps.contentRoot(), extensionId, digest);
    await mkdir(contentPath, { recursive: true });
    await writeFile(join(contentPath, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
    const prior = this.installs().find((entry) => entry.extensionId === extensionId);
    const consent = this.consentPayload(manifest, digest, subpath);
    const record: ConsentRecord = { ...consent, at: this.deps.now(), actor: 'user', ...(reconsent ? { reconsent: true } : {}) };
    const result = await this.deps.registry.importManifest(JSON.stringify(manifest), {
      kind: 'imported',
      path: contentPath,
      importedAt: record.at,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (!prior) {
      await this.deps.registry.setEnabled(extensionId, false);
    }
    const install: SourceInstallRecord = {
      extensionId,
      sourceId: source.id,
      subpath,
      version: consent.version,
      digest,
      pinRef: ref,
      refHistory: [...(prior?.refHistory ?? []), { ref, digest, at: record.at }],
      consents: [...(prior?.consents ?? []), record],
      provenance: consent.provenance,
      contentPath,
    };
    await this.updateMiniApps({
      sourceInstalls: [...this.installs().filter((entry) => entry.extensionId !== extensionId), install],
    });
    return { ok: true, extensionId, view: this.installView(install) };
  }

  // ------------------------------------------------------------- plumbing

  private sources(): MiniAppSourceRecord[] {
    return this.deps.miniApps().sources;
  }

  private installs(): SourceInstallRecord[] {
    return this.deps.miniApps().sourceInstalls;
  }

  private installedManifest(extensionId: string): Record<string, unknown> | null {
    const pack = this.deps.miniApps().packs.find((entry) => (entry.manifest as { id?: unknown })?.id === extensionId);
    return pack ? (pack.manifest as Record<string, unknown>) : null;
  }

  private descriptorOf(source: MiniAppSourceRecord): ValidatedSourceDescriptor {
    return {
      kind: source.kind,
      origin: source.origin,
      document: source.descriptor,
      subpath: typeof source.descriptor.subpath === 'string' ? source.descriptor.subpath : '',
    };
  }

  private async fetchTree(descriptor: ValidatedSourceDescriptor, consume: (tree: string, resolved: ResolvedRef) => Promise<void>): Promise<void> {
    const ref = (descriptor.document.ref ?? {}) as { strategy?: string; value?: string };
    const strategy = String(ref.strategy ?? '');
    const token = await this.firstCredentialToken(descriptor);
    const resolved = await this.deps.transport.resolve(descriptor.origin, { strategy, value: ref.value });
    const root = await this.deps.transport.tempRoot();
    try {
      const tree = join(root, 'tree');
      await this.deps.transport.fetch(descriptor.origin, resolved, tree, token);
      await consume(tree, resolved);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async firstCredentialToken(descriptor: ValidatedSourceDescriptor): Promise<string | null> {
    for (const slot of credentialSlots(descriptor)) {
      const value = await this.deps.secretStore.get(slot);
      if (value) {
        return value;
      }
    }
    return null;
  }

  private async updateMiniApps(patch: { sources?: MiniAppSourceRecord[]; sourceInstalls?: SourceInstallRecord[] }): Promise<void> {
    await this.deps.updateMiniApps(patch);
  }

  private sourceView(source: MiniAppSourceRecord): MiniAppSourceView {
    const ref = (source.descriptor.ref ?? {}) as { strategy?: string; value?: string };
    return {
      id: source.id,
      kind: source.kind,
      origin: source.origin,
      status: source.status,
      ...(source.error ? { error: source.error } : {}),
      ...(source.lastCheckedAt !== undefined ? { lastCheckedAt: source.lastCheckedAt } : {}),
      ...(source.lastSuccessAt !== undefined ? { lastSuccessAt: source.lastSuccessAt } : {}),
      consecutiveFailures: source.consecutiveFailures,
      candidates: source.candidates,
      ref: ref.strategy ? { strategy: ref.strategy, ...(ref.value !== undefined ? { value: ref.value } : {}) } : null,
      subpath: typeof source.descriptor.subpath === 'string' ? source.descriptor.subpath : '',
      installs: this.installs()
        .filter((install) => install.sourceId === source.id)
        .map((install) => this.installView(install)),
    };
  }

  private installView(install: SourceInstallRecord): MiniAppSourceInstallView {
    const packs = this.deps.miniApps().packs;
    const pack = packs.find((entry) => (entry.manifest as { id?: unknown })?.id === install.extensionId);
    return {
      extensionId: install.extensionId,
      sourceId: install.sourceId,
      version: install.version,
      digest: install.digest,
      pinRef: install.pinRef,
      parked: install.parked !== undefined,
      ...(install.parked ? { parkedReason: install.parked.reason } : {}),
      originClass: 'imported',
      provenance: install.provenance,
      consentedAt: install.consents.length > 0 ? install.consents[install.consents.length - 1].at : null,
      update: install.update ?? null,
      enabled: pack?.enabled ?? false,
      ...(pack?.error ? { error: pack.error } : {}),
    };
  }
}

// ---------------------------------------------------------- discovery

export interface DiscoveredManifest {
  extensionId: string;
  subpath: string;
  manifest: unknown;
}

/** Manifest discovery: the subpath dir (root when absent) plus ONE level of child dirs. */
export async function discoverManifests(tree: string, subpath: string): Promise<DiscoveredManifest[]> {
  const base = subpath ? join(tree, subpath) : tree;
  if (!base.startsWith(tree)) {
    throw new GitTransportError('path-denied', 'subpath escapes the fetched tree');
  }
  let entries: { isDirectory(): boolean; name: string }[];
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    throw new GitTransportError('io', `the source tree is unreadable at ${subpath || 'root'}`);
  }
  const dirs = [base, ...entries.filter((entry) => entry.isDirectory()).map((entry) => join(base, entry.name))].sort();
  const found: DiscoveredManifest[] = [];
  for (const dir of dirs) {
    const manifestPath = join(dir, MANIFEST_FILE);
    let raw: Buffer;
    try {
      raw = await readFile(manifestPath);
    } catch {
      continue;
    }
    if (raw.byteLength > MANIFEST_MAX_BYTES) {
      throw new GitTransportError('invalid', `${MANIFEST_FILE} exceeds the ${MANIFEST_MAX_BYTES}-byte cap`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      throw new GitTransportError('invalid', `manifest is not JSON: ${(error as Error).message}`);
    }
    const verdict = checkSchema(ENVELOPE_SCHEMA, parsed);
    if (!verdict.ok) {
      const detail = verdict.issues
        .slice(0, 5)
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ');
      throw new GitTransportError('invalid', `manifest invalid against the family envelope: ${detail}`);
    }
    const manifest = parsed as { id?: unknown };
    found.push({
      extensionId: String(manifest.id ?? ''),
      subpath: dir === tree ? '' : dir.slice(tree.length + 1),
      manifest: parsed,
    });
  }
  return found;
}

// ------------------------------------------------------------- diffing

/**
 * The byte-identical-manifest test fields (D22): capabilities +
 * configSchema — unchanged is the ONLY condition under which a T0 data
 * diff may auto-apply. Diffing runs against the projected candidate so
 * both sides speak the pack-manifest vocabulary.
 */
export function manifestDiff(
  installed: Record<string, unknown> | null,
  candidate: { capabilities: string[]; configSchema?: unknown; version: string }
): ManifestDiff {
  const candidateCaps = new Set(candidate.capabilities);
  const installedCaps = new Set((installed?.capabilities as string[] | undefined) ?? []);
  const added = [...candidateCaps].filter((capability) => !installedCaps.has(capability)).sort();
  return {
    versionFrom: String(installed?.version ?? ''),
    versionTo: String(candidate.version ?? ''),
    capabilitiesAdded: added,
    configSchemaChanged: JSON.stringify(installed?.configSchema ?? null) !== JSON.stringify(candidate.configSchema ?? null),
  };
}

function credentialSlots(descriptor: ValidatedSourceDescriptor): string[] {
  const credentials = descriptor.document.credentials;
  if (!Array.isArray(credentials)) {
    return [];
  }
  return credentials
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).slot : undefined))
    .filter((slot): slot is string => typeof slot === 'string');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toFailure(error: unknown): LifecycleFailure {
  if (error instanceof GitTransportError) {
    return { code: error.code, detail: error.message };
  }
  return { code: 'io', detail: String((error as Error)?.message ?? error) };
}

function toFailureText(error: unknown): string {
  const failure = toFailure(error);
  return `${failure.code}: ${failure.detail}`;
}
