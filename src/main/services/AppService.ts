import type { AppConfig } from '@shared/config/AppConfig';
import {
  appEnvSecretKey,
  appHeaderSecretKey,
  baseRiskOf,
  effectiveRiskOf,
  parseToolApp,
  riskTightensOnly,
  type EntityScope,
  type ToolAppSaveInput,
  type ToolAppSpec,
  type ToolAppStatus,
  type ToolAppToolState,
  type ToolAppView,
  type ToolAppsSettings,
} from '@shared/apps';
import type {
  McpServerConfig,
  McpServerSaveInput,
  McpServerStatus,
  McpServerView,
  McpTestResult,
  McpToolOverride,
} from '@shared/mcp';
import type { McpSecrets } from '../ai/tools/mcp';
import type { ToolRiskClass } from '@shared/turns';
import { bundledPresetById, type ToolAppPreset } from '@shared/app-presets';

export interface AppServiceDeps {
  config(): AppConfig;
  updateToolApps(patch: Partial<ToolAppsSettings>): Promise<void>;
  nativeToolNames(): string[];
  mcpStatusFor(serverId: string): McpServerStatus | undefined;
  cachedMcpToolNames(serverId: string): string[];
  cachedMcpToolInfos(serverId: string): { name: string; description: string }[];
  cacheAgeMs(serverId: string): number | null;
  refreshServerTools(server: McpServerConfig): Promise<void>;
  testServer(server: McpServerConfig): Promise<McpTestResult>;
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  hasSecret(key: string): Promise<boolean>;
  newId(): string;
  resetConnections(): Promise<void>;
}

export const TOOL_CACHE_TTL_MS = 5 * 60_000;

export type AppOperationResult = { ok: true } | { ok: false; error: string };

export type SaveAppResult = { ok: true; view: ToolAppView } | { ok: false; error: string };

function parseJsonMap(raw: string | null): Record<string, string> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

function mcpSourceOf(app: ToolAppSpec): { kind: 'mcp'; server: McpServerConfig } | undefined {
  return app.sources.find((source): source is { kind: 'mcp'; server: McpServerConfig } => source.kind === 'mcp');
}

function serverNameOf(app: ToolAppSpec): string | undefined {
  return mcpSourceOf(app)?.server.name;
}

function serverIdOf(app: ToolAppSpec): string | undefined {
  return mcpSourceOf(app)?.server.id;
}

/**
 * Owns tool-app definitions + lifecycle state (plan 15 S1): validated CRUD,
 * the pinned boot pipeline (migrate-secrets → validate → D13 reconcile →
 * health), the keyring seam (`app:<id>:*`, deletion included) and the
 * per-app view of MCP server configs the tool substrate consumes. App
 * enable state, toolState and scope only ever narrow what the backing
 * server allows (D4) — this service never widens reach.
 */
export class AppService {
  /** Ordered boot-step trace (plan 15 S1 boot-order assertion). */
  readonly bootTrace: string[] = [];

  constructor(private readonly deps: AppServiceDeps) {}

  private refreshingServers = new Set<string>();

  /** Fire-and-forget TTL pass: re-lists enabled MCP snapshots older than `TOOL_CACHE_TTL_MS`. */
  private kickStaleCaches(): void {
    for (const appSpec of this.apps()) {
      if (!appSpec.enabled) {
        continue;
      }
      const mcp = mcpSourceOf(appSpec);
      if (!mcp || this.refreshingServers.has(mcp.server.id)) {
        continue;
      }
      const age = this.deps.cacheAgeMs(mcp.server.id);
      if (age !== null && age <= TOOL_CACHE_TTL_MS) {
        continue;
      }
      this.refreshingServers.add(mcp.server.id);
      void this.deps
        .refreshServerTools(mcp.server)
        .catch(() => undefined)
        .finally(() => this.refreshingServers.delete(mcp.server.id));
    }
  }

  private settings(): ToolAppsSettings {
    return this.deps.config().toolApps;
  }

  private apps(): ToolAppSpec[] {
    return this.settings().apps;
  }

  private app(appId: string): ToolAppSpec | undefined {
    return this.apps().find((candidate) => candidate.id === appId);
  }

  /**
   * Locates an app by app id or by its backing server id — MCP runtime
   * state is server-keyed while keyring blobs are app-keyed, and the
   * compat surface addresses apps by server id.
   */
  private locate(ref: string): ToolAppSpec | undefined {
    return this.apps().find((candidate) => candidate.id === ref || serverIdOf(candidate) === ref);
  }

  private blobOwner(ref: string): ToolAppSpec | undefined {
    return this.locate(ref);
  }

  private async persistApps(apps: ToolAppSpec[]): Promise<void> {
    await this.deps.updateToolApps({ apps });
  }

  // ————— Boot pipeline (order-pinned, never bricks the app) —————

  async boot(): Promise<void> {
    await this.migrateLegacySecrets();
    await this.validateStoredApps();
    await this.reconcileCachedTools();
    this.snapshotHealth();
  }

  /** D11/B3: one-time `mcp:<id>:*` → `app:<id>:*` keyring re-namespacing. */
  private async migrateLegacySecrets(): Promise<void> {
    this.bootTrace.push('migrate-secrets');
    for (const app of this.apps()) {
      for (const [legacyKey, nextKey] of [
        [`mcp:${app.id}:env`, appEnvSecretKey(app.id)],
        [`mcp:${app.id}:headers`, appHeaderSecretKey(app.id)],
      ] as const) {
        if (!(await this.deps.hasSecret(nextKey))) {
          const legacy = await this.deps.getSecret(legacyKey);
          if (legacy !== null) {
            await this.deps.setSecret(nextKey, legacy);
          }
        }
        await this.deps.deleteSecret(legacyKey);
      }
    }
  }

  /**
   * zod re-validation + uniqueness + native-group resolution; an app that
   * no longer validates self-disables with a surfaced error (plan 14 D10
   * posture) — never a failed boot.
   */
  private async validateStoredApps(): Promise<void> {
    this.bootTrace.push('validate');
    const nativeNames = new Set(this.deps.nativeToolNames());
    let changed = false;
    const seenIds = new Set<string>();
    const seenServerNames = new Set<string>();
    const seenServerIds = new Set<string>();
    const apps = this.apps().map((app) => ({ ...app }));
    for (const app of apps) {
      const error = this.validate(app, nativeNames, seenIds, seenServerNames, seenServerIds);
      seenIds.add(app.id);
      const serverName = serverNameOf(app);
      if (serverName) {
        seenServerNames.add(serverName);
      }
      const serverId = serverIdOf(app);
      if (serverId) {
        seenServerIds.add(serverId);
      }
      if (error && (app.error !== error || app.enabled)) {
        app.enabled = false;
        app.error = error;
        changed = true;
      } else if (!error && app.error) {
        delete app.error;
        changed = true;
      }
    }
    if (changed) {
      await this.persistApps(apps);
    }
  }

  /** Shape + cross-app validation; the id/name sets must already exclude the candidate. */
  private validate(
    app: ToolAppSpec,
    nativeNames: Set<string>,
    seenIds: Set<string>,
    seenServerNames: Set<string>,
    seenServerIds: Set<string>
  ): string | null {
    const parsed = parseToolApp(app);
    if (!parsed.ok) {
      return parsed.error;
    }
    if (seenIds.has(app.id)) {
      return `duplicate app id '${app.id}'`;
    }
    const serverName = serverNameOf(parsed.app);
    if (serverName && seenServerNames.has(serverName)) {
      return `duplicate backing server name '${serverName}'`;
    }
    const serverId = serverIdOf(parsed.app);
    if (serverId && seenServerIds.has(serverId)) {
      return `duplicate backing server id '${serverId}'`;
    }
    for (const source of parsed.app.sources) {
      if (source.kind === 'native-group') {
        const unresolved = source.tools.filter((name) => !nativeNames.has(name));
        if (unresolved.length > 0) {
          return `unresolved native tools: ${unresolved.join(', ')}`;
        }
      }
    }
    return null;
  }

  /** D13 boot pass — reconciles against the cached tool snapshot only. */
  private async reconcileCachedTools(): Promise<void> {
    this.bootTrace.push('reconcile');
    for (const app of this.apps()) {
      const mcp = mcpSourceOf(app);
      if (!mcp) {
        continue;
      }
      const known = this.deps.cachedMcpToolNames(mcp.server.id);
      if (known.length > 0) {
        await this.reconcileFromToolList(app.id, known);
      }
    }
  }

  private snapshotHealth(): void {
    this.bootTrace.push('health');
    for (const app of this.apps()) {
      const mcp = mcpSourceOf(app);
      if (mcp) {
        this.deps.mcpStatusFor(mcp.server.id);
      }
    }
  }

  // ————— D13 reconciliation (live pass — after every tool listing) —————

  /**
   * Prunes stale `toolState` keys for tools the server no longer exposes.
   * New tools stay ABSENT from `toolState` (= default enabled, the plan 11
   * denylist posture); the view marks them so the UI can surface them.
   */
  async reconcileFromToolList(appId: string, liveToolNames: string[]): Promise<boolean> {
    const app = this.locate(appId);
    if (!app || !mcpSourceOf(app)) {
      return false;
    }
    const live = new Set(liveToolNames);
    const stale = Object.keys(app.toolState).filter((name) => !live.has(name));
    const preset = app.presetId ? bundledPresetById(app.presetId) : undefined;
    const authored = preset
      ? liveToolNames.filter(
          (name) => !app.toolState[name] && preset.toolDomains.some((domain) => domain.tool === name)
        )
      : [];
    if (stale.length === 0 && authored.length === 0) {
      return false;
    }
    const toolState = { ...app.toolState };
    for (const name of stale) {
      delete toolState[name];
    }
    for (const name of authored) {
      const domain = preset!.toolDomains.find((candidate) => candidate.tool === name)!;
      toolState[name] = {
        enabled: true,
        keywordTags: domain.keywordTags,
        ...(domain.baseRisk ? { baseRisk: domain.baseRisk } : {}),
        ...(domain.entityRole ? { entityRole: domain.entityRole } : {}),
        ...(domain.entityArg ? { entityArg: domain.entityArg } : {}),
      };
    }
    await this.persistApps(
      this.apps().map((candidate) => (candidate.id === app.id ? { ...candidate, toolState } : candidate))
    );
    return true;
  }

  // ————— MCP substrate bridge (seams unchanged — plan 11 contracts) —————

  /** Effective MCP server configs; empty when the master switch is off. */
  listServerConfigs(): McpServerConfig[] {
    const settings = this.settings();
    if (!settings.masterEnabled) {
      return [];
    }
    const servers: McpServerConfig[] = [];
    for (const app of settings.apps) {
      const mcp = mcpSourceOf(app);
      if (!mcp) {
        continue;
      }
      servers.push({ ...mcp.server, enabled: app.enabled && !app.error });
    }
    return servers;
  }

  /** Enabled apps in spec order (plan 15 S2 selection input). */
  listEnabled(): ToolAppSpec[] {
    const settings = this.settings();
    if (!settings.masterEnabled) {
      return [];
    }
    return settings.apps.filter((app) => app.enabled && !app.error);
  }

  /**
   * Namespaced name of the app's first discovery tool (D18 scope-preview
   * seam — the settings tab invokes it to seed the device picker).
   */
  firstDiscoveryTool(appId: string): string | null {
    const app = this.locate(appId);
    const mcp = app ? mcpSourceOf(app) : undefined;
    if (!app || !mcp) {
      return null;
    }
    for (const [raw, state] of Object.entries(app.toolState)) {
      if (state.entityRole === 'discovery' && state.enabled !== false) {
        return `mcp__${mcp.server.name}__${raw}`;
      }
    }
    return null;
  }

  serverConfigFor(appId: string): McpServerConfig | null {
    const app = this.locate(appId);
    const mcp = app ? mcpSourceOf(app) : undefined;
    return mcp ? { ...mcp.server, enabled: true } : null;
  }

  /** Namespaced-name lookup translated to the owning app's `toolState`. */
  toolOverrideFor(namespacedToolName: string): McpToolOverride | undefined {
    const [raw, state] = this.resolveNamespaced(namespacedToolName);
    if (raw === null) {
      return undefined;
    }
    if (!state) {
      return undefined;
    }
    return { enabled: state.enabled ? undefined : false, risk: effectiveRiskOf(state) };
  }

  private resolveNamespaced(namespacedToolName: string): [string, ToolAppToolState | undefined] | [null, undefined] {
    for (const app of this.apps()) {
      const serverName = serverNameOf(app);
      if (!serverName) {
        continue;
      }
      const prefix = `mcp__${serverName}__`;
      if (!namespacedToolName.startsWith(prefix)) {
        continue;
      }
      const raw = namespacedToolName.slice(prefix.length);
      if (raw.length > 0) {
        return [raw, app.toolState[raw]];
      }
    }
    return [null, undefined];
  }

  async readServerSecrets(serverId: string): Promise<McpSecrets> {
    const owner = this.blobOwner(serverId);
    if (!owner) {
      return {};
    }
    const [env, headers] = await Promise.all([
      this.deps.getSecret(appEnvSecretKey(owner.id)),
      this.deps.getSecret(appHeaderSecretKey(owner.id)),
    ]);
    return { env: parseJsonMap(env), headers: parseJsonMap(headers) };
  }

  // ————— State for the renderer (masked — secrets never cross) —————

  /** Native tool count for the budget card's engine-accurate total. */
  nativeToolCount(): number {
    return this.deps.nativeToolNames().length;
  }

  async getState(): Promise<ToolAppView[]> {
    this.kickStaleCaches();
    const views: ToolAppView[] = [];
    for (const app of this.apps()) {
      const mcp = mcpSourceOf(app);
      const [envRaw, headersRaw] = mcp
        ? await Promise.all([
            this.deps.getSecret(appEnvSecretKey(app.id)),
            this.deps.getSecret(appHeaderSecretKey(app.id)),
          ])
        : [null, null];
      const knownTools = mcp
        ? this.deps
            .cachedMcpToolInfos(mcp.server.id)
            .map((info) => ({ name: info.name, description: info.description, state: app.toolState[info.name] ?? null }))
        : Object.keys(app.toolState).map((name) => ({ name, description: '', state: app.toolState[name] ?? null }));
      views.push({
        app: { ...app },
        status: this.statusFor(app),
        envKeys: Object.keys(parseJsonMap(envRaw) ?? {}),
        headerKeys: Object.keys(parseJsonMap(headersRaw) ?? {}),
        knownTools,
      });
    }
    return views;
  }

  private statusFor(app: ToolAppSpec): ToolAppStatus | null {
    const mcp = mcpSourceOf(app);
    if (!mcp) {
      return null;
    }
    const status = this.deps.mcpStatusFor(mcp.server.id);
    return {
      appId: app.id,
      state: status?.state ?? 'disconnected',
      toolCount: status?.toolCount ?? 0,
      latencyMs: status?.latencyMs ?? null,
      lastError: status?.lastError ?? null,
    };
  }

  // ————— CRUD (main-validated; renderer input is untrusted) —————

  async saveApp(input: ToolAppSaveInput): Promise<SaveAppResult> {
    const { env, headers, promptNotes: _rendererNotes, ...incoming } = input;
    if (!incoming.id) {
      incoming.id = this.deps.newId();
    }
    for (const source of incoming.sources) {
      if (source.kind === 'mcp' && !source.server.id) {
        source.server.id = this.deps.newId();
      }
    }
    if (incoming.presetId && !bundledPresetById(incoming.presetId)) {
      return { ok: false, error: `unknown preset '${incoming.presetId}'` };
    }
    const stored = this.locate(incoming.id);
    const presetId = incoming.presetId ?? stored?.presetId;
    const preset = presetId ? bundledPresetById(presetId) : undefined;
    const authoredNotes = preset?.promptNotes ?? stored?.promptNotes;
    const serverId = (Array.isArray(incoming.sources) ? serverIdOf(incoming as ToolAppSpec) : undefined) ?? incoming.id;
    const spec: ToolAppSpec = {
      ...incoming,
      toolState: this.applyAuthoredTemplate(
        incoming.toolState ?? {},
        stored,
        preset,
        this.deps.cachedMcpToolNames(serverId)
      ),
      ...(authoredNotes ? { promptNotes: authoredNotes } : {}),
      ...(presetId ? { presetId } : {}),
    };
    const nativeNames = new Set(this.deps.nativeToolNames());
    const others = this.apps().filter((candidate) => candidate.id !== spec.id);
    const error = this.validate(
      spec,
      nativeNames,
      new Set(others.map((candidate) => candidate.id)),
      new Set(others.map(serverNameOf).filter((name): name is string => name !== undefined)),
      new Set(others.map(serverIdOf).filter((id): id is string => id !== undefined))
    );
    if (error) {
      return { ok: false, error };
    }
    const parsed = parseToolApp(spec);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    const known = this.deps.cachedMcpToolNames(serverIdOf(spec) ?? spec.id);
    if (known.length > 0) {
      const unknown = Object.keys(parsed.app.toolState).filter((name) => !known.includes(name));
      if (unknown.length > 0) {
        return { ok: false, error: `unknown tools in toolState: ${unknown.join(', ')}` };
      }
    }
    if (env !== undefined) {
      await this.deps.setSecret(appEnvSecretKey(spec.id), JSON.stringify(env));
    }
    if (headers !== undefined) {
      await this.deps.setSecret(appHeaderSecretKey(spec.id), JSON.stringify(headers));
    }
    await this.persistApps([...others, parsed.app]);
    const mcp = mcpSourceOf(parsed.app);
    if (mcp) {
      const result = await this.deps.testServer({ ...mcp.server, enabled: true }).catch(() => undefined);
      if (result?.ok) {
        const listed = this.deps.cachedMcpToolNames(serverIdOf(parsed.app) ?? parsed.app.id);
        if (listed.length > 0) {
          await this.reconcileFromToolList(spec.id, listed);
        }
      }
    }
    const view = (await this.getState()).find((candidate) => candidate.app.id === parsed.app.id);
    return view ? { ok: true, view } : { ok: false, error: 'app disappeared after save' };
  }

  /**
   * Authored fields (`baseRisk`, entity role/arg, `promptNotes`) come only
   * from presets or the D11 migration — renderer-submitted values are
   * stripped and stored/authored values are kept, so no renderer surface
   * can loosen a risk class (D4) or inject guidance (§4 author policy).
   */
  private applyAuthoredTemplate(
    incoming: Record<string, ToolAppToolState>,
    stored: ToolAppSpec | undefined,
    preset: ToolAppPreset | undefined,
    knownToolNames: string[]
  ): Record<string, ToolAppToolState> {
    const next: Record<string, ToolAppToolState> = {};
    const names = new Set([...Object.keys(incoming), ...(knownToolNames.length > 0 ? knownToolNames : [])]);
    for (const name of names) {
      const state = incoming[name];
      const authored = stored?.toolState[name];
      const domain = preset?.toolDomains.find((candidate) => candidate.tool === name);
      const merged: ToolAppToolState = {
        enabled: state?.enabled ?? authored?.enabled ?? true,
        keywordTags: state?.keywordTags ?? authored?.keywordTags ?? domain?.keywordTags ?? [],
        ...((authored?.baseRisk ?? domain?.baseRisk) ? { baseRisk: authored?.baseRisk ?? domain?.baseRisk } : {}),
        ...((authored?.entityRole ?? domain?.entityRole) ? { entityRole: authored?.entityRole ?? domain?.entityRole } : {}),
        ...((authored?.entityArg ?? domain?.entityArg) ? { entityArg: authored?.entityArg ?? domain?.entityArg } : {}),
        ...(state?.riskOverride !== undefined
          ? { riskOverride: state.riskOverride }
          : authored?.riskOverride !== undefined
            ? { riskOverride: authored.riskOverride }
            : {}),
      };
      next[name] = merged;
    }
    return next;
  }

  /** Removing an app deletes its keyring blobs — no orphaned tokens (D5/D11). */
  async removeApp(appId: string): Promise<AppOperationResult> {
    const app = this.locate(appId);
    if (!app) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    await this.persistApps(this.apps().filter((candidate) => candidate.id !== app.id));
    for (const key of [
      appEnvSecretKey(app.id),
      appHeaderSecretKey(app.id),
      `mcp:${app.id}:env`,
      `mcp:${app.id}:headers`,
    ]) {
      await this.deps.deleteSecret(key);
    }
    await this.deps.resetConnections();
    return { ok: true };
  }

  async setMasterEnabled(enabled: boolean): Promise<AppOperationResult> {
    await this.deps.updateToolApps({ masterEnabled: enabled });
    return { ok: true };
  }

  async setAppEnabled(appId: string, enabled: boolean): Promise<AppOperationResult> {
    const app = this.locate(appId);
    if (!app) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    if (enabled && app.error) {
      return { ok: false, error: `app is disabled by validation: ${app.error}` };
    }
    await this.persistApps(
      this.apps().map((candidate) => (candidate.id === app.id ? { ...candidate, enabled } : candidate))
    );
    return { ok: true };
  }

  async setToolState(
    appId: string,
    toolName: string,
    patch: Partial<Pick<ToolAppToolState, 'enabled' | 'keywordTags' | 'riskOverride'>> | null
  ): Promise<AppOperationResult> {
    const app = this.locate(appId);
    if (!app) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    const current = app.toolState[toolName];
    if (patch === null) {
      if (!current) {
        return { ok: true };
      }
      return this.writeToolState(app.id, toolName, null);
    }
    if (patch.riskOverride !== undefined) {
      const base = baseRiskOf(current);
      if (!riskTightensOnly(base, patch.riskOverride)) {
        return { ok: false, error: `risk override for '${toolName}' may only tighten (base: ${base})` };
      }
    }
    if (patch.keywordTags !== undefined) {
      if (patch.keywordTags.length > 20 || patch.keywordTags.some((tag) => !tag || tag.length > 64)) {
        return { ok: false, error: 'invalid keyword tags' };
      }
    }
    const next: ToolAppToolState = {
      enabled: patch.enabled ?? current?.enabled ?? true,
      keywordTags: patch.keywordTags ?? current?.keywordTags ?? [],
      ...(current?.baseRisk ? { baseRisk: current.baseRisk } : {}),
      ...(patch.riskOverride !== undefined
        ? { riskOverride: patch.riskOverride }
        : current?.riskOverride !== undefined
          ? { riskOverride: current.riskOverride }
          : {}),
    };
    return this.writeToolState(app.id, toolName, next);
  }

  private async writeToolState(
    appId: string,
    toolName: string,
    state: ToolAppToolState | null
  ): Promise<AppOperationResult> {
    const candidate = this.app(appId);
    if (!candidate) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    const toolState = { ...candidate.toolState };
    if (state === null) {
      delete toolState[toolName];
    } else {
      toolState[toolName] = state;
    }
    if (!candidate) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    const parsed = parseToolApp({ ...candidate, toolState });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    await this.persistApps(
      this.apps().map((entry) => (entry.id === appId ? { ...entry, toolState } : entry))
    );
    return { ok: true };
  }

  async setEntityScope(appId: string, scope: EntityScope | null): Promise<AppOperationResult> {
    const app = this.locate(appId);
    if (!app) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    if (scope && app.sources.some((source) => source.kind === 'native-group')) {
      return { ok: false, error: 'entityScope applies to MCP-backed apps only' };
    }
    const candidate: ToolAppSpec = { ...app };
    if (scope) {
      candidate.entityScope = scope;
    } else {
      delete candidate.entityScope;
    }
    const parsed = parseToolApp(candidate);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    await this.persistApps(this.apps().map((entry) => (entry.id === app.id ? parsed.app : entry)));
    return { ok: true };
  }

  async testConnection(appId: string): Promise<McpTestResult | { ok: false; error: string }> {
    const app = this.locate(appId);
    if (!app) {
      return { ok: false, error: `unknown app '${appId}'` };
    }
    const mcp = mcpSourceOf(app);
    if (!mcp) {
      return { ok: false, error: `app '${appId}' has no MCP server` };
    }
    const result = await this.deps.testServer({ ...mcp.server, enabled: true });
    if (result.ok) {
      const listed = this.deps.cachedMcpToolNames(mcp.server.id);
      if (listed.length > 0) {
        await this.reconcileFromToolList(app.id, listed);
      }
    }
    return result;
  }

  // ————— mcp:* compat surface (plan 11 channels over the app store; retires in S5) —————

  async mcpServerViews(): Promise<McpServerView[]> {
    const views: McpServerView[] = [];
    for (const server of this.listServerConfigs()) {
      const owner = this.blobOwner(server.id);
      const [envRaw, headersRaw] = owner
        ? await Promise.all([
            this.deps.getSecret(appEnvSecretKey(owner.id)),
            this.deps.getSecret(appHeaderSecretKey(owner.id)),
          ])
        : [null, null];
      const status = this.deps.mcpStatusFor(server.id);
      views.push({
        config: server,
        envKeys: Object.keys(parseJsonMap(envRaw) ?? {}),
        headerKeys: Object.keys(parseJsonMap(headersRaw) ?? {}),
        status:
          status ?? {
            serverId: server.id,
            state: 'disconnected',
            toolCount: 0,
            latencyMs: null,
            lastError: null,
            lastConnectedAt: null,
          },
      });
    }
    return views;
  }

  async saveMcpServer(input: McpServerSaveInput): Promise<SaveAppResult> {
    const { env, headers, ...server } = input;
    const existing = this.apps().find((app) => serverNameOf(app) !== undefined && mcpSourceOf(app)?.server.id === server.id);
    return this.saveApp({
      id: server.id,
      name: existing?.name ?? server.name,
      ...(existing?.icon ? { icon: existing.icon } : {}),
      ...(existing?.description ? { description: existing.description } : {}),
      enabled: existing?.enabled ?? true,
      sources: [{ kind: 'mcp', server: { ...server, enabled: true } }],
      toolState: existing?.toolState ?? {},
      exposure: existing?.exposure ?? 'relevance',
      ...(env !== undefined ? { env } : {}),
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  /**
   * Legacy per-tool override channel. Preserves plan 11 semantics on the
   * transitional surface: risk values write the authored baseline (the
   * old channel accepted any risk); the new `apps:*` surface is
   * tighten-only (D4) and this path disappears with the Tools-tab MCP
   * section in S5.
   */
  async setMcpToolOverride(
    namespacedToolName: string,
    override: { enabled?: boolean; risk?: ToolRiskClass } | null
  ): Promise<AppOperationResult> {
    for (const app of this.apps()) {
      const serverName = serverNameOf(app);
      if (!serverName) {
        continue;
      }
      const prefix = `mcp__${serverName}__`;
      if (!namespacedToolName.startsWith(prefix) || namespacedToolName.length <= prefix.length) {
        continue;
      }
      const raw = namespacedToolName.slice(prefix.length);
      if (override === null) {
        return this.setToolState(app.id, raw, null);
      }
      const current = app.toolState[raw];
      return this.writeToolState(app.id, raw, {
        enabled: override.enabled ?? current?.enabled ?? true,
        keywordTags: current?.keywordTags ?? [],
        ...((override.risk ?? current?.baseRisk) ? { baseRisk: override.risk ?? current?.baseRisk } : {}),
      });
    }
    return { ok: false, error: `unknown MCP tool '${namespacedToolName}'` };
  }
}
