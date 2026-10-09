import type { AppConfig } from '@shared/config/AppConfig';
import {
  validateManifest,
  validatePackConfig,
  type ImportMiniAppResult,
  type MiniAppSaveConfigResult,
  type MiniAppSetEnabledResult,
  type MiniAppsSettings,
  type MiniAppView,
  type PackKind,
  type PackValidationIssue,
  type ValidatedPack,
} from '@shared/app-pack';

export interface InstalledMiniApp {
  manifest: unknown;
  origin: { kind: 'bundled' | 'imported'; path?: string; importedAt?: number };
  digest: string;
  enabled: boolean;
  error?: string;
  config?: Record<string, unknown>;
}

export interface MiniAppRegistryDeps {
  config(): AppConfig;
  updateMiniApps(patch: Partial<MiniAppsSettings>): Promise<void>;
  now(): number;
  sha256(input: string): string;
}

export function formatPackIssues(issues: PackValidationIssue[], cap = 3): string {
  const head = issues.slice(0, cap).map((issue) => `${issue.path}: ${issue.message}`);
  const tail = issues.length > cap ? ` (+${issues.length - cap} more)` : '';
  return `${head.join('; ')}${tail}`;
}

function label(manifest: { i18n?: { defaultLocale: string; locales: Record<string, Record<string, string>> } }, key: string): string | undefined {
  const i18n = manifest.i18n;
  if (!i18n?.defaultLocale || !i18n.locales?.[i18n.defaultLocale]) {
    return undefined;
  }
  return i18n.locales[i18n.defaultLocale][key] ?? undefined;
}

function configFieldViews(pack: ValidatedPack): MiniAppView['configFields'] {
  const schema = pack.manifest.configSchema;
  if (!schema) {
    return [];
  }
  return Object.entries(schema.properties).map(([name, field]) => {
    if (field.type === 'string') {
      return {
        name,
        type: 'string' as const,
        ...(field.enum ? { enum: field.enum } : {}),
        ...(field.default !== undefined ? { default: field.default } : {}),
        ...(field.pattern !== undefined ? { pattern: field.pattern } : {}),
      };
    }
    if (field.type === 'number') {
      return {
        name,
        type: 'number' as const,
        ...(field.default !== undefined ? { default: field.default } : {}),
        ...(field.minimum !== undefined ? { minimum: field.minimum } : {}),
        ...(field.maximum !== undefined ? { maximum: field.maximum } : {}),
      };
    }
    if (field.type === 'boolean') {
      return { name, type: 'boolean' as const, ...(field.default !== undefined ? { default: field.default } : {}) };
    }
    return {
      name,
      type: 'array' as const,
      ...(field.default !== undefined ? { default: field.default } : {}),
      ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
      ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
    };
  });
}

/**
 * Installed mini-app packs (plan 26 S1): install/enable/disable/remove,
 * digest + origin, apiVersion negotiation and the AppService-style boot
 * self-disable pipeline. Validation itself lives in the ONE shared
 * validator (`@shared/app-pack`) — this registry never re-implements it.
 */
export class MiniAppRegistry {
  constructor(private readonly deps: MiniAppRegistryDeps) {}

  private settings(): MiniAppsSettings {
    return this.deps.config().miniApps;
  }

  private locate(id: string): InstalledMiniApp | undefined {
    return this.settings().packs.find((pack) => (pack.manifest as { id?: unknown })?.id === id);
  }

  private async persist(packs: InstalledMiniApp[]): Promise<void> {
    await this.deps.updateMiniApps({ packs });
  }

  private validateInstalled(installed: InstalledMiniApp): { ok: true; pack: ValidatedPack } | { ok: false; reason: string } {
    const digest = this.deps.sha256(JSON.stringify(installed.manifest));
    if (digest !== installed.digest) {
      return { ok: false, reason: 'Stored manifest digest mismatch — the pack was modified after install.' };
    }
    const result = validateManifest(installed.manifest, { bundled: installed.origin.kind === 'bundled' });
    if (!result.ok) {
      return { ok: false, reason: formatPackIssues(result.issues) };
    }
    return { ok: true, pack: result.pack };
  }

  /** Boot pipeline (AppService pattern): revalidate everything, self-disable on any violation. */
  async reconcile(): Promise<number> {
    let disabled = 0;
    const packs = this.settings().packs;
    for (let index = 0; index < packs.length; index += 1) {
      const installed = packs[index];
      const verdict = this.validateInstalled(installed);
      const error = verdict.ok ? undefined : verdict.reason;
      if (error !== installed.error) {
        packs[index] = { ...installed, error };
        disabled += 1;
      }
    }
    if (disabled > 0) {
      await this.persist(packs);
    }
    return disabled;
  }

  /**
   * Installs bundled packs (plan 26 S7): validated as bundled manifests,
   * origin `bundled`, only when the id is not already installed — a
   * user import or upgrade is never clobbered. Returns ids installed.
   */
  async ensureBundled(manifests: unknown[]): Promise<string[]> {
    const installed: string[] = [];
    for (const manifest of manifests) {
      const result = validateManifest(manifest, { bundled: true });
      if (!result.ok) {
        console.error('Bundled mini-app pack failed validation:', result.issues[0]?.path, result.issues[0]?.message);
        continue;
      }
      const id = result.pack.manifest.id;
      if (this.locate(id)) {
        continue;
      }
      await this.importManifest(JSON.stringify(manifest), { kind: 'bundled' });
      installed.push(id);
    }
    return installed;
  }

  async importManifest(json: string, origin: InstalledMiniApp['origin']): Promise<ImportMiniAppResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'The file is not valid JSON.' };
    }
    const result = validateManifest(parsed, { bundled: origin.kind === 'bundled' });
    if (!result.ok) {
      return { ok: false, error: formatPackIssues(result.issues) };
    }
    const incoming = parsed as { id: string; version: string };
    const existing = this.locate(incoming.id);
    if (existing && !versionGreaterThan(incoming.version, (existing.manifest as { version: string }).version)) {
      return {
        ok: false,
        error: `Version ${incoming.version} does not increase the installed ${(existing.manifest as { version: string }).version} — an import over an installed id must raise the version.`,
      };
    }
    const installed: InstalledMiniApp = {
      manifest: parsed,
      origin: origin.kind === 'imported' ? { ...origin, importedAt: this.deps.now() } : origin,
      digest: this.deps.sha256(JSON.stringify(parsed)),
      enabled: existing?.enabled ?? true,
      config: existing?.config,
    };
    const packs = this.settings().packs.filter((pack) => (pack.manifest as { id?: unknown })?.id !== incoming.id);
    packs.push(installed);
    await this.persist(packs);
    return { ok: true, view: this.viewOf(installed) };
  }

  async remove(id: string): Promise<boolean> {
    const packs = this.settings().packs;
    if (!packs.some((pack) => (pack.manifest as { id?: unknown })?.id === id)) {
      return false;
    }
    await this.persist(packs.filter((pack) => (pack.manifest as { id?: unknown })?.id !== id));
    return true;
  }

  async setEnabled(id: string | null, enabled: boolean): Promise<MiniAppSetEnabledResult> {
    if (id === null) {
      await this.deps.updateMiniApps({ masterEnabled: enabled });
      return { ok: true };
    }
    const packs = [...this.settings().packs];
    const index = packs.findIndex((pack) => (pack.manifest as { id?: unknown })?.id === id);
    if (index < 0) {
      return { ok: false, error: 'Unknown pack.' };
    }
    const target = packs[index];
    if (enabled && target.error) {
      return { ok: false, error: target.error };
    }
    packs[index] = { ...target, enabled };
    await this.persist(packs);
    return { ok: true };
  }

  async saveConfig(id: string, values: unknown): Promise<MiniAppSaveConfigResult> {
    const installed = this.locate(id);
    if (!installed) {
      return { ok: false, error: 'Unknown pack.' };
    }
    const verdict = this.validateInstalled(installed);
    if (!verdict.ok) {
      return { ok: false, error: verdict.reason };
    }
    const result = validatePackConfig(verdict.pack, values);
    if (!result.ok) {
      return { ok: false, error: formatPackIssues(result.issues) };
    }
    const packs = this.settings().packs.map((pack) =>
      (pack.manifest as { id?: unknown })?.id === id ? { ...pack, config: result.values } : pack
    );
    await this.persist(packs);
    return { ok: true, values: result.values };
  }

  private viewOf(installed: InstalledMiniApp): MiniAppView {
    const manifest = installed.manifest as {
      id: string;
      version: string;
      kind: PackKind;
      capabilities: string[];
      icon?: string;
      i18n?: { defaultLocale: string; locales: Record<string, Record<string, string>> };
    };
    const validated = validateManifest(installed.manifest, { bundled: installed.origin.kind === 'bundled' });
    return {
      id: manifest.id,
      version: manifest.version,
      kind: manifest.kind,
      title: label(manifest, 'title') ?? manifest.id,
      ...(label(manifest, 'description') ? { description: label(manifest, 'description') } : {}),
      ...(manifest.icon ? { icon: manifest.icon } : {}),
      capabilities: manifest.capabilities ?? [],
      enabled: installed.enabled,
      ...(installed.error ? { error: installed.error } : {}),
      originKind: installed.origin.kind,
      ...(installed.origin.kind === 'imported' && installed.origin.importedAt
        ? { importedAt: installed.origin.importedAt }
        : {}),
      configFields: validated.ok ? configFieldViews(validated.pack) : [],
      configValues: installed.config ?? {},
    };
  }

  getState(): { masterEnabled: boolean; packs: MiniAppView[] } {
    const settings = this.settings();
    return {
      masterEnabled: settings.masterEnabled,
      packs: settings.packs.map((installed) => this.viewOf(installed)),
    };
  }

  /** The validated pack a later stage (S2+/S3) may execute; null unless runnable. */
  runnablePack(id: string): ValidatedPack | null {
    const installed = this.locate(id);
    if (!installed || !installed.enabled || installed.error || !this.settings().masterEnabled) {
      return null;
    }
    const verdict = this.validateInstalled(installed);
    return verdict.ok ? verdict.pack : null;
  }
}

function versionGreaterThan(candidate: string, installed: string): boolean {
  const parse = (version: string) => version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10));
  const [aMajor, aMinor, aPatch] = parse(candidate);
  const [bMajor, bMinor, bPatch] = parse(installed);
  if (aMajor !== bMajor) return aMajor > bMajor;
  if (aMinor !== bMinor) return aMinor > bMinor;
  return aPatch > bPatch;
}
