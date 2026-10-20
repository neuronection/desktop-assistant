import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  ENVELOPE_SCHEMA,
  type AddSourceResult,
  type ApplyUpdateResult,
  type ConsentEcho,
  type ConsentPayload,
  type ConsentRecord,
  type InstallExtensionResult,
  type ManifestChange,
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
import { consentEchoMatches, isConsentEcho } from '@shared/app-pack';
import { DOCS_POINTER, checkExtensionDocsTree } from '@shared/app-pack';
import { projectEnvelope, T0_DECLARATIVE_DISCLOSURE, T2_SANDBOX_DISCLOSURE } from '@shared/app-pack/mapping';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import { envelopeRegistrationProblems } from '@shared/app-pack/registration';
import { validateManifest } from '@shared/app-pack/validate';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
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
  /**
   * The production local-source gate (the vendored sources schema MUST
   * clause: hosts gate the `local` kind off in production boots,
   * fail-closed). Wired to the dev-mode signal at the composition root.
   */
  localSourcesAllowed(): boolean;
  /**
   * The allowlisted roots a `local` source must resolve under (the same
   * MUST clause's confinement half, mirroring career's
   * `extension_local_source_roots`). Empty ⇒ every local source is
   * refused, fail-closed. Comparisons happen on RESOLVED paths, so a
   * symlink or traversal cannot point outside a root.
   */
  localSourceRoots(): readonly string[];
}

type LifecycleFailure = { code: string; detail: string };

/**
 * The family sources pipeline (plan 32 Phase 8, plan 37 §3.3–3.5 — the TS
 * adoption of the career reference semantics against the same vendored
 * schemas): one pipeline for git (https) and local file-path sources —
 * resolve → shallow fetch → manifest discovery (root + one level) →
 * envelope schema validation → host-profile mapping/compat → per-extension
 * consent → pinned, content-addressed install.
 *
 * Identity and consent (the family law, stated once):
 * - `digest` is the CONTENT-TREE digest at EVERY tier (`digestTree`): the
 *   pin/integrity identity, never a projection of the manifest JSON.
 * - T0 auto-applies ONLY when the full canonical manifest is byte-identical
 *   (`manifestDiff.byteIdentical`). Any difference — version, i18n labels,
 *   report/liveCard nodes, data, provenance, capabilities, configSchema or
 *   anything else — re-consents with a machine change-summary. T2 always
 *   re-consents: there is no code auto-apply path at all.
 * - Digest drift at a pinned ref is a loud failure, never a silent refetch.
 * - Consent is MAIN-VERIFIED (H4): the renderer echoes what the consent
 *   surface displayed and the service re-derives digest + capabilities from
 *   the refetched content at land time — echo values are compared, never
 *   recorded.
 * - Local file-path sources are production-gated AND confined to
 *   allowlisted roots, both fail-closed (the vendored sources schema's MUST
 *   clause; no root configured ⇒ refused).
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
    const confined = this.confineSource(descriptor);
    if (!confined.ok) {
      return { ok: false, error: confined.failure.detail };
    }
    if (this.sources().some((source) => source.origin === confined.descriptor.origin)) {
      return { ok: false, error: `Source already exists: ${confined.descriptor.origin}` };
    }
    for (const [slot, value] of Object.entries(secretValues ?? {})) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
        return { ok: false, error: `Secret value for slot '${slot}' is malformed.` };
      }
      if (!credentialSlots(confined.descriptor).includes(slot)) {
        return { ok: false, error: `Descriptor declares no credential slot '${slot}'.` };
      }
      await this.deps.secretStore.set(slot, value);
    }
    const record: MiniAppSourceRecord = {
      id: this.deps.newId(),
      kind: descriptor.kind,
      origin: confined.descriptor.origin,
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
    const confined = this.confineSource(descriptor);
    if (!confined.ok) {
      return { ok: false, error: { code: confined.failure.code, detail: confined.failure.detail } };
    }
    const candidates: SourceCandidate[] = [];
    const candidateManifests = new Map<string, Record<string, unknown>>();
    try {
      await this.fetchTree(confined.descriptor, async (tree, resolved) => {
        for (const found of await discoverManifests(tree, confined.descriptor.subpath)) {
          if (found.tier === 'T0') {
            try {
              const candidate = this.candidateFor(found, resolved.ref);
              candidates.push({
                extensionId: candidate.extensionId,
                subpath: candidate.subpath,
                digest: candidate.digest,
                ref: candidate.ref,
                compatible: true,
                ...(candidate.configSchema !== undefined ? { configSchema: candidate.configSchema } : {}),
                consent: candidate.consent,
              });
              candidateManifests.set(candidate.extensionId, candidate.manifest);
            } catch (error) {
              const reason = error instanceof GitTransportError ? error.message : String((error as Error)?.message ?? error);
              candidates.push({
                extensionId: found.extensionId,
                subpath: found.subpath,
                digest: '',
                ref: resolved.ref,
                compatible: false,
                reason,
                consent: this.consentPayload(found.manifest as Record<string, unknown>, '', found.subpath, 'T0'),
              });
            }
            continue;
          }
          const candidate = this.candidateFor(found, resolved.ref);
          candidates.push({
            extensionId: candidate.extensionId,
            subpath: candidate.subpath,
            digest: candidate.digest,
            ref: candidate.ref,
            compatible: true,
            ...(candidate.configSchema !== undefined ? { configSchema: candidate.configSchema } : {}),
            consent: candidate.consent,
          });
          candidateManifests.set(candidate.extensionId, candidate.manifest);
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
    const { installs, reports, driftError } = this.checkUpdates(sourceId, candidates, candidateManifests);
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

  private consentPayload(envelope: Record<string, unknown>, digest: string, subpath: string, tier: 'T0' | 'T2'): ConsentPayload {
    return {
      extensionId: String(envelope.id ?? ''),
      version: String(envelope.version ?? ''),
      subpath,
      digest,
      tier,
      importClass: 'imported',
      originClass: 'imported',
      capabilities: Array.isArray(envelope.capabilities) ? (envelope.capabilities as string[]) : [],
      provenance: {
        author: optionalString(envelope.author),
        license: optionalString(envelope.license),
        repository: optionalString(envelope.repository),
        description: optionalString(envelope.description),
      },
      disclosure: tier === 'T2' ? T2_SANDBOX_DISCLOSURE : T0_DECLARATIVE_DISCLOSURE,
    };
  }

  async installExtension(sourceId: string, extensionId: string, consent: ConsentEcho): Promise<InstallExtensionResult> {
    if (!isConsentEcho(consent)) {
      return {
        ok: false,
        error: 'Consent must echo the digest and capabilities the consent surface displayed — a renderer-asserted boolean is not consent (D7).',
      };
    }
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: 'Unknown source.' };
    }
    const confined = this.confineSource(this.descriptorOf(source));
    if (!confined.ok) {
      return { ok: false, error: failureText(confined.failure) };
    }
    const candidate = source.candidates.find((entry) => entry.extensionId === extensionId);
    if (!candidate) {
      return { ok: false, error: `Extension '${extensionId}' is not offered by this source — run Check for updates.` };
    }
    let hit: { manifest: Record<string, unknown>; digest: string; ref: string; tier: 'T0' | 'T2'; files: { relative: string; bytes: Buffer }[] } | null = null;
    try {
      hit = await this.refetchCandidate(confined.descriptor, extensionId);
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
    const actual = this.consentPayload(hit.manifest, hit.digest, candidate.subpath, hit.tier);
    if (!consentEchoMatches(consent, actual)) {
      return {
        ok: false,
        error: 'The consent does not match the content being installed — the digest or capability set differs from what the consent surface displayed. Re-check the source and re-consent.',
      };
    }
    return this.landInstall(source, extensionId, hit, candidate.subpath, false);
  }

  /**
   * One discovered manifest as a candidate: T0 projects the family envelope;
   * T2 is the pack manifest itself. BOTH are digest-pinned on the CONTENT
   * TREE (plan 37 §3.3 — one identity notion, every tier), never on a
   * projection of the manifest JSON.
   */
  private candidateFor(found: DiscoveredManifest, ref: string): {
    extensionId: string;
    subpath: string;
    digest: string;
    ref: string;
    manifest: Record<string, unknown>;
    configSchema?: unknown;
    consent: ConsentPayload;
  } {
    const digest = digestTree(found.contentDir);
    if (found.tier === 'T2') {
      const manifest = found.manifest as Record<string, unknown>;
      return {
        extensionId: found.extensionId,
        subpath: found.subpath,
        digest,
        ref,
        manifest,
        ...(manifest.configSchema !== undefined ? { configSchema: manifest.configSchema } : {}),
        consent: this.consentPayload(manifest, digest, found.subpath, 'T2'),
      };
    }
    const projection = projectEnvelope(found.manifest as Record<string, unknown>);
    if (!projection.ok) {
      throw new GitTransportError('invalid', `the extension is not hostable: ${projection.reason}`);
    }
    return {
      extensionId: found.extensionId,
      subpath: found.subpath,
      digest,
      ref,
      manifest: projection.manifest,
      ...(projection.manifest.configSchema !== undefined ? { configSchema: projection.manifest.configSchema } : {}),
      consent: this.consentPayload(found.manifest as Record<string, unknown>, digest, found.subpath, 'T0'),
    };
  }

  /** Re-fetch + re-discover one extension (the pin discipline: land exactly what was consented). */
  private async refetchCandidate(
    descriptor: ValidatedSourceDescriptor,
    extensionId: string
  ): Promise<{ manifest: Record<string, unknown>; digest: string; ref: string; tier: 'T0' | 'T2'; files: { relative: string; bytes: Buffer }[] } | null> {
    const hits: { manifest: Record<string, unknown>; digest: string; ref: string; tier: 'T0' | 'T2'; files: { relative: string; bytes: Buffer }[] }[] = [];
    await this.fetchTree(descriptor, async (tree, resolved) => {
      for (const found of await discoverManifests(tree, descriptor.subpath)) {
        if (found.extensionId !== extensionId) {
          continue;
        }
        const candidate = this.candidateFor(found, resolved.ref);
        hits.push({
          manifest: candidate.manifest,
          digest: candidate.digest,
          ref: candidate.ref,
          tier: found.tier,
          files: found.tier === 'T2' ? readSubtree(found.contentDir) : [],
        });
      }
    });
    return hits[0] ?? null;
  }

  // ------------------------------------------------------------- updates

  private checkUpdates(
    sourceId: string,
    candidates: SourceCandidate[],
    candidateManifests: Map<string, Record<string, unknown>>
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
      const diff = manifestDiff(
        this.installedManifest(install.extensionId),
        candidateManifests.get(install.extensionId) ?? {}
      );
      installs[index] = {
        ...install,
        update: {
          state: 'available',
          ref: candidate.ref,
          digest: candidate.digest,
          manifestDiff: diff,
          requiresReconsent: candidate.consent.tier === 'T2' || !diff.byteIdentical,
        },
      };
      reports.push({ extensionId: install.extensionId, state: 'available' });
    }
    return { installs: installs.map((install) => ({ ...install })), reports, driftError };
  }

  async applyUpdate(sourceId: string, extensionId: string, consent: ConsentEcho | null): Promise<ApplyUpdateResult> {
    const install = this.installs().find((entry) => entry.extensionId === extensionId);
    if (!install || install.sourceId !== sourceId) {
      return { ok: false, error: 'Unknown installed extension for this source.' };
    }
    const update = install.update;
    if (!update || update.state !== 'available') {
      return { ok: false, error: `No update is available (state: ${update?.state ?? 'none'}).` };
    }
    if (update.requiresReconsent && consent === null) {
      return {
        ok: false,
        error: 'This update grows the extension or changes its config schema — explicit re-consent is required (D15/D22).',
      };
    }
    if (consent !== null && !isConsentEcho(consent)) {
      return {
        ok: false,
        error: 'Consent must echo the digest and capabilities the consent surface displayed — a renderer-asserted boolean is not consent (D7).',
      };
    }
    const source = this.sources().find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, error: 'The source is gone — re-add it and re-consent.' };
    }
    const localGate = this.confineSource(this.descriptorOf(source));
    if (!localGate.ok) {
      return { ok: false, error: failureText(localGate.failure) };
    }
    const descriptor = localGate.descriptor;
    try {
      const hit = await this.refetchCandidate(descriptor, extensionId);
      if (hit === null) {
        return { ok: false, error: 'The update disappeared from the source — re-run Check for updates.' };
      }
      if (hit.digest !== update.digest) {
        return { ok: false, error: 'The source moved again mid-apply — re-run Check for updates; pins untouched.' };
      }
      if (consent !== null) {
        const actual = this.consentPayload(hit.manifest, hit.digest, install.subpath, hit.tier);
        if (!consentEchoMatches(consent, actual)) {
          return {
            ok: false,
            error: 'The consent does not match the content being applied — the digest or capability set differs from what the consent surface displayed. Re-check the source and re-consent.',
          };
        }
      }
      return this.landInstall(source, extensionId, hit, install.subpath, consent !== null);
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
    hit: { manifest: Record<string, unknown>; digest: string; ref: string; tier: 'T0' | 'T2'; files: { relative: string; bytes: Buffer }[] },
    subpath: string,
    reconsent: boolean
  ): Promise<InstallExtensionResult> {
    const contentPath = join(this.deps.contentRoot(), extensionId, hit.digest);
    await mkdir(contentPath, { recursive: true });
    await writeFile(join(contentPath, MANIFEST_FILE), JSON.stringify(hit.manifest, null, 2), 'utf8');
    for (const file of hit.files) {
      if (file.relative.split('/').includes('..') || join(contentPath, file.relative).startsWith(contentPath) === false) {
        return { ok: false, error: `the content tree tried to escape its directory: ${file.relative}` };
      }
      const target = join(contentPath, file.relative);
      await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
      await writeFile(target, file.bytes);
    }
    if (hit.tier === 'T2' && digestTree(contentPath) !== hit.digest) {
      return { ok: false, error: 'the landed content does not hash to the pinned digest — refusing to install (digest drift)' };
    }
    const prior = this.installs().find((entry) => entry.extensionId === extensionId);
    const consent = this.consentPayload(hit.manifest, hit.digest, subpath, hit.tier);
    const record: ConsentRecord = { ...consent, at: this.deps.now(), actor: 'user', ...(reconsent ? { reconsent: true } : {}) };
    // The byte-identical auto-apply window moves the pin/digest, not the
    // installed artifact: re-importing the same T0 version would be refused
    // (and would be a no-op anyway), so the registry is left untouched.
    // T2 always re-imports: its content dir is the spawn path and must
    // follow the new digest.
    const installedManifest = this.installedManifest(extensionId);
    const manifestUnchanged =
      hit.tier === 'T0' && installedManifest !== null && canonicalJson(installedManifest) === canonicalJson(hit.manifest);
    if (!manifestUnchanged) {
      const result = await this.deps.registry.importManifest(JSON.stringify(hit.manifest), {
        kind: 'imported',
        path: contentPath,
        importedAt: record.at,
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
    }
    if (!prior) {
      await this.deps.registry.setEnabled(extensionId, false);
    }
    const install: SourceInstallRecord = {
      extensionId,
      sourceId: source.id,
      subpath,
      version: consent.version,
      digest: hit.digest,
      pinRef: hit.ref,
      refHistory: [...(prior?.refHistory ?? []), { ref: hit.ref, digest: hit.digest, at: record.at }],
      consents: [...(prior?.consents ?? []), record],
      provenance: consent.provenance,
      contentPath,
      ...(hit.tier === 'T2' ? { contentDigest: hit.digest } : {}),
    };
    await this.updateMiniApps({
      sourceInstalls: [...this.installs().filter((entry) => entry.extensionId !== extensionId), install],
    });
    return { ok: true, extensionId, view: this.installView(install) };
  }

  // ------------------------------------------------------------- plumbing

  private confineSource(
    descriptor: ValidatedSourceDescriptor
  ): { ok: true; descriptor: ValidatedSourceDescriptor } | { ok: false; failure: LifecycleFailure } {
    if (descriptor.kind !== 'local') {
      return { ok: true, descriptor };
    }
    if (!this.deps.localSourcesAllowed()) {
      return {
        ok: false,
        failure: {
          code: 'path-denied',
          detail:
            'Local file-path sources are gated off in production boots — https git sources only (the vendored sources schema: hosts MUST gate the local kind off in production, fail-closed).',
        },
      };
    }
    const roots = this.deps.localSourceRoots().map((root) => realPath(resolve(root)));
    if (roots.length === 0) {
      return {
        ok: false,
        failure: {
          code: 'path-denied',
          detail:
            'Local file-path sources need an allowlisted root (DA_EXTENSION_LOCAL_SOURCE_ROOTS) — none configured, fail-closed.',
        },
      };
    }
    const lexical = resolve(descriptor.origin);
    const resolved = realPath(lexical);
    for (const root of roots) {
      if (!resolvesUnder(resolved, root)) {
        continue;
      }
      if (!existsSync(resolved)) {
        return { ok: false, failure: { code: 'not-found', detail: `Local source path does not exist: ${resolved}` } };
      }
      return { ok: true, descriptor: { ...descriptor, origin: resolved } };
    }
    return {
      ok: false,
      failure: {
        code: 'path-denied',
        detail: `Local source ${resolved} is outside every allowlisted root — refusing (symlinks are resolved before the comparison).`,
      },
    };
  }

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
    const resolved = await this.deps.transport.resolve(descriptor.origin, { strategy, value: ref.value }, token);
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
  /** Tier provenance (ADR-0030): T0 family envelope, or T2 when the content carries a code entry. */
  tier: 'T0' | 'T2';
  /** The manifest's directory in the fetched tree — the T2 content subtree root. */
  contentDir: string;
}

/** Career's tree-digest algorithm (sorted rel paths + NUL + size + NUL + bytes; .git/symlinks skipped). */
export function digestTree(root: string): string {
  const digest = createHash('sha256');
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const relative = full.slice(root.length + 1);
      if (relative.split('/').includes('.git') || entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        if (entry.isDirectory()) {
          walk(full);
        }
        continue;
      }
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      digest.update(relative);
      digest.update('\0');
      digest.update(String(stats.size));
      digest.update('\0');
      digest.update(readFileSync(full));
    }
  };
  walk(root);
  return digest.digest('hex');
}

/** The T2 classification: a desktop pack manifest whose content carries a code entry, normative-validated as sandboxed. */
function classifySandboxedManifest(parsed: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof parsed !== 'object' || parsed === null || (parsed as { code?: unknown }).code === undefined) {
    return { ok: false, reason: 'not a code pack and not a valid family envelope' };
  }
  const verdict = validateManifest(parsed, { bundled: false, sandboxed: true });
  if (!verdict.ok) {
    const detail = verdict.issues
      .slice(0, 3)
      .map((issue) => `${issue.path} ${issue.message}`)
      .join('; ');
    return { ok: false, reason: `sandboxed manifest invalid: ${detail}` };
  }
  return { ok: true };
}

/**
 * The docs-pointer binding (plan 34 §10.5): a manifest carrying the
 * pointer promises a tree that exists in the bundle and validates —
 * a broken promise rejects discovery exactly like an invalid manifest
 * (the extension never half-installs with a docs promise it breaks).
 */
async function checkDocsBinding(contentDir: string, manifest: unknown): Promise<void> {
  const pointer = (manifest as { docs?: unknown } | null)?.docs;
  if (pointer === undefined) {
    return;
  }
  if (pointer !== DOCS_POINTER) {
    throw new GitTransportError('invalid', `docs pointer must be '${DOCS_POINTER}' (got ${JSON.stringify(pointer)})`);
  }
  const treePath = join(contentDir, 'docs', 'docs-tree.json');
  let raw: Buffer;
  try {
    raw = await readFile(treePath);
  } catch {
    throw new GitTransportError('invalid', `manifest points at ${DOCS_POINTER} but the tree does not exist in the bundle`);
  }
  if (raw.byteLength > MANIFEST_MAX_BYTES) {
    throw new GitTransportError('invalid', `docs-tree.json exceeds the ${MANIFEST_MAX_BYTES}-byte cap`);
  }
  let tree: unknown;
  try {
    tree = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new GitTransportError('invalid', `docs tree is not JSON: ${(error as Error).message}`);
  }
  const problems = checkExtensionDocsTree(tree, (file) => existsSync(join(contentDir, 'docs', file)));
  if (problems.length > 0) {
    throw new GitTransportError('invalid', `docs tree invalid: ${problems.slice(0, 3).join('; ')}`);
  }
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
    const envelopeVerdict = checkSchema(ENVELOPE_SCHEMA, parsed);
    if (envelopeVerdict.ok) {
      const semantic = envelopeRegistrationProblems(parsed);
      if (semantic.length > 0) {
        throw new GitTransportError(
          'invalid',
          `manifest invalid (registration semantics): ${semantic.slice(0, 3).join('; ')}`,
        );
      }
      const manifest = parsed as { id?: unknown };
      await checkDocsBinding(dir, parsed);
      found.push({
        extensionId: String(manifest.id ?? ''),
        subpath: dir === tree ? '' : dir.slice(tree.length + 1),
        manifest: parsed,
        tier: 'T0',
        contentDir: dir,
      });
      continue;
    }
    const sandboxed = classifySandboxedManifest(parsed);
    if (!sandboxed.ok) {
      const detail = envelopeVerdict.issues
        .slice(0, 5)
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ');
      throw new GitTransportError('invalid', `manifest invalid against the family envelope: ${detail} (${sandboxed.reason})`);
    }
    const manifest = parsed as { id?: unknown };
    await checkDocsBinding(dir, parsed);
    found.push({
      extensionId: String(manifest.id ?? ''),
      subpath: dir === tree ? '' : dir.slice(tree.length + 1),
      manifest: parsed,
      tier: 'T2',
      contentDir: dir,
    });
  }
  return found;
}

// ------------------------------------------------------------- diffing

/**
 * The manifest diff law (plan 37 §3.3, F10): the candidate and the
 * installed manifest are compared as the FULL canonical manifest — every
 * field participates, so `byteIdentical` is the only condition under which
 * a T0 update may auto-apply. Capability growth and configSchema changes
 * keep their named flags (the browser-permission model), and `changed` is
 * the machine change-summary a consent surface renders.
 *
 * Both sides speak the pack-manifest vocabulary: for T0 the candidate is
 * the projected manifest, exactly the form the registry installed.
 */
export function manifestDiff(installed: Record<string, unknown> | null, candidate: Record<string, unknown>): ManifestDiff {
  const candidateCaps = new Set(Array.isArray(candidate.capabilities) ? (candidate.capabilities as string[]) : []);
  const installedCaps = new Set(Array.isArray(installed?.capabilities) ? (installed?.capabilities as string[]) : []);
  const added = [...candidateCaps].filter((capability) => !installedCaps.has(capability)).sort();
  const changed: ManifestChange[] = [];
  let byteIdentical = false;
  if (installed === null) {
    // No installed baseline (manual install/state loss): never an auto-apply window.
    changed.push('other');
  } else {
    byteIdentical = canonicalJson(installed) === canonicalJson(candidate);
    const covered = new Set(DIFF_GROUPS.flatMap((group) => group.fields));
    for (const group of DIFF_GROUPS) {
      if (canonicalJson(pick(installed, group.fields)) !== canonicalJson(pick(candidate, group.fields))) {
        changed.push(group.change);
      }
    }
    if (canonicalJson(pickExcept(installed, covered)) !== canonicalJson(pickExcept(candidate, covered))) {
      changed.push('other');
    }
  }
  return {
    byteIdentical,
    changed,
    versionFrom: String(installed?.version ?? ''),
    versionTo: String(candidate.version ?? ''),
    capabilitiesAdded: added,
    configSchemaChanged: canonicalJson(installed?.configSchema ?? null) !== canonicalJson(candidate.configSchema ?? null),
  };
}

/** The named change groups, in consent-surface order (what changed, not a full diff). */
const DIFF_GROUPS: { change: ManifestChange; fields: string[] }[] = [
  { change: 'version', fields: ['version'] },
  { change: 'i18n', fields: ['i18n'] },
  { change: 'report', fields: ['report'] },
  { change: 'liveCard', fields: ['liveCard'] },
  { change: 'data', fields: ['data'] },
  { change: 'provenance', fields: ['author', 'license', 'repository', 'categories', 'docs'] },
  { change: 'capabilities', fields: ['capabilities'] },
  { change: 'configSchema', fields: ['configSchema', 'defaults'] },
];

function pick(record: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      picked[field] = record[field];
    }
  }
  return picked;
}

function pickExcept(record: Record<string, unknown>, excluded: Set<string>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!excluded.has(key) && value !== undefined) {
      picked[key] = value;
    }
  }
  return picked;
}

/** One canonical form (sorted keys, `undefined` dropped) so key order can never fake a diff. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        out[key] = canonicalize(record[key]);
      }
    }
    return out;
  }
  return value;
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

/** Symlinks are resolved BEFORE any comparison; a missing path falls back to its lexical form (then `not-found`). */
function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when `target` is `root` or lives beneath it (path-segment aware, never a string prefix test). */
function resolvesUnder(target: string, root: string): boolean {
  const rel = relative(root, target);
  if (rel === '') {
    return true;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The T2 content subtree, read during the fetch window (≤ the 2 MiB budget; .git/symlinks skipped). */
function readSubtree(root: string): { relative: string; bytes: Buffer }[] {
  const files: { relative: string; bytes: Buffer }[] = [];
  let total = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const relative = full.slice(root.length + 1);
      if (relative.split('/').includes('.git') || entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        if (entry.isDirectory()) {
          walk(full);
        }
        continue;
      }
      const bytes = readFileSync(full);
      total += bytes.byteLength;
      if (total > 2 * 1024 * 1024) {
        throw new GitTransportError('invalid', 'the code-pack content exceeds the 2 MiB budget');
      }
      files.push({ relative, bytes });
    }
  };
  walk(root);
  return files;
}

function toFailure(error: unknown): LifecycleFailure {
  if (error instanceof GitTransportError) {
    return { code: error.code, detail: error.message };
  }
  return { code: 'io', detail: String((error as Error)?.message ?? error) };
}

function failureText(failure: LifecycleFailure): string {
  return `${failure.code}: ${failure.detail}`;
}

function toFailureText(error: unknown): string {
  return failureText(toFailure(error));
}
