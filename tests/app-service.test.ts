import { describe, expect, it } from 'vitest';
import { AppService, TOOL_CACHE_TTL_MS, type AppServiceDeps } from '@main/services/AppService';
import { appEnvSecretKey, appHeaderSecretKey, type ToolAppSpec, type ToolAppToolState, type ToolAppsSettings } from '@shared/apps';
import type { McpServerConfig, McpServerStatus, McpTestResult } from '@shared/mcp';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';

const NATIVE_TOOLS = ['screen_capture', 'run_shell'];

function mcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'srv-ha',
    name: 'homeassistant',
    transport: { type: 'http', url: 'http://homeassistant.local:8124/mcp' },
    enabled: true,
    defaultAction: 'allow',
    ...overrides,
  };
}

function app(overrides: Partial<ToolAppSpec> = {}): ToolAppSpec {
  return {
    id: 'app-ha',
    name: 'Home Assistant',
    enabled: true,
    sources: [{ kind: 'mcp', server: mcpServer() }],
    toolState: {},
    exposure: 'relevance',
    ...overrides,
  };
}

function harness(initial: Partial<{ settings: ToolAppsSettings; cached: Record<string, string[]>; statuses: Record<string, McpServerStatus>; cacheAges: Record<string, number | null> }> = {}) {
  let settings: ToolAppsSettings = initial.settings ?? { masterEnabled: true, apps: [] };
  const secrets = new Map<string, string>();
  const cached = new Map<string, string[]>(Object.entries(initial.cached ?? {}));
  const statuses = new Map<string, McpServerStatus>(Object.entries(initial.statuses ?? {}));
  const cacheAges = new Map<string, number | null>(Object.entries(initial.cacheAges ?? {}).map(([k, v]) => [k, v as number | null]));
  const refreshedServers: string[] = [];
  const refreshGates = new Map<string, 'resolve' | 'reject'>();
  let refreshHold: Promise<void> = Promise.resolve();
  let connectionResets = 0;
  const config = (): AppConfig => ({ ...DEFAULT_CONFIG, toolApps: settings });
  const deps: AppServiceDeps = {
    config,
    updateToolApps: async (patch) => {
      settings = { ...settings, ...patch };
    },
    nativeToolNames: () => NATIVE_TOOLS,
    mcpStatusFor: (serverId) => statuses.get(serverId),
    cachedMcpToolNames: (serverId) => cached.get(serverId) ?? [],
    cachedMcpToolInfos: (serverId) => (cached.get(serverId) ?? []).map((name) => ({ name, description: '' })),
    cacheAgeMs: (serverId) => cacheAges.get(serverId) ?? null,
    refreshServerTools: async (server) => {
      await refreshHold;
      refreshedServers.push(server.id);
      if (refreshGates.get(server.id) === 'reject') {
        throw new Error('boom');
      }
      cacheAges.set(server.id, 0);
    },
    testServer: async (): Promise<McpTestResult> => ({ ok: true, latencyMs: 12, toolCount: 2 }),
    getSecret: async (key) => secrets.get(key) ?? null,
    setSecret: async (key, value) => {
      secrets.set(key, value);
    },
    deleteSecret: async (key) => {
      secrets.delete(key);
    },
    hasSecret: async (key) => secrets.has(key),
    newId: () => 'generated-id',
    resetConnections: async () => {
      connectionResets += 1;
    },
  };
  return {
    service: new AppService(deps),
    readSettings: (): ToolAppsSettings => settings,
    secrets,
    cached,
    statuses,
    readConnectionResets: (): number => connectionResets,
    refreshedServers,
    refreshGates,
    cacheAges,
    holdRefresh: (gate: Promise<void>) => {
      refreshHold = gate;
    },
  };
}

describe('AppService boot pipeline (plan 15 S1)', () => {
  it('runs the pinned boot order', async () => {
    const h = harness();
    await h.service.boot();
    expect(h.service.bootTrace).toEqual(['migrate-secrets', 'validate', 'reconcile', 'health']);
  });

  it('re-namespaces legacy mcp:<id>:* blobs to app:<id>:* and deletes the legacy keys', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    h.secrets.set('mcp:app-ha:env', JSON.stringify({ TOKEN: 'secret-value' }));
    h.secrets.set('mcp:app-ha:headers', JSON.stringify({ Authorization: 'Bearer x' }));
    await h.service.boot();
    expect(h.secrets.get('app:app-ha:env')).toBe(JSON.stringify({ TOKEN: 'secret-value' }));
    expect(h.secrets.get('app:app-ha:headers')).toBe(JSON.stringify({ Authorization: 'Bearer x' }));
    expect(h.secrets.has('mcp:app-ha:env')).toBe(false);
    expect(h.secrets.has('mcp:app-ha:headers')).toBe(false);
  });

  it('keeps existing app: blobs and drops legacy leftovers when both exist', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    h.secrets.set('app:app-ha:env', JSON.stringify({ TOKEN: 'current' }));
    h.secrets.set('mcp:app-ha:env', JSON.stringify({ TOKEN: 'stale' }));
    await h.service.boot();
    expect(h.secrets.get('app:app-ha:env')).toBe(JSON.stringify({ TOKEN: 'current' }));
    expect(h.secrets.has('mcp:app-ha:env')).toBe(false);
  });

  it('self-disables an invalid stored app with a surfaced error and never throws', async () => {
    const broken = app({ exposure: 'sometimes' as ToolAppSpec['exposure'] });
    const valid = app({ id: 'app-native', name: 'Desktop', sources: [{ kind: 'native-group', tools: ['screen_capture'] }] });
    const h = harness({ settings: { masterEnabled: true, apps: [valid, broken] } });
    await h.service.boot();
    const settings = h.readSettings();
    const disabled = settings.apps.find((candidate) => candidate.id === 'app-ha');
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.error).toBeTruthy();
    expect(settings.apps.find((candidate) => candidate.id === 'app-native')?.enabled).toBe(true);
  });

  it('self-disables duplicate app ids and duplicate backing servers', async () => {
    const first = app();
    const dupId = app({ name: 'Other instance' });
    const dupServer = app({ id: 'app-other', name: 'Other' });
    const h = harness({ settings: { masterEnabled: true, apps: [first, dupId, dupServer] } });
    await h.service.boot();
    const settings = h.readSettings();
    const sameId = settings.apps.filter((candidate) => candidate.id === 'app-ha');
    expect(sameId[0]?.enabled).toBe(true);
    expect(sameId.some((candidate) => candidate.enabled === false)).toBe(true);
    const other = settings.apps.find((candidate) => candidate.id === 'app-other');
    expect(other?.enabled).toBe(false);
    expect(other?.error).toContain('duplicate backing server');
  });

  it('self-disables a native-group app referencing unresolved native tools', async () => {
    const stale = app({
      id: 'app-native',
      name: 'Desktop',
      sources: [{ kind: 'native-group', tools: ['screen_capture', 'renamed_tool'] }],
    });
    const h = harness({ settings: { masterEnabled: true, apps: [stale] } });
    await h.service.boot();
    const disabled = h.readSettings().apps[0];
    expect(disabled.enabled).toBe(false);
    expect(disabled.error).toContain('renamed_tool');
  });

  it('clears a stale error once the app validates again', async () => {
    const errored = app({ enabled: false, error: 'old problem' });
    const h = harness({ settings: { masterEnabled: true, apps: [errored] } });
    await h.service.boot();
    expect(h.readSettings().apps[0].error).toBeUndefined();
  });
});

describe('AppService D13 reconciliation', () => {
  it('prunes stale toolState keys and leaves unknown tools absent (default enabled)', async () => {
    const stored = app({
      toolState: {
        get_status: { enabled: true, keywordTags: [] },
        vanished_tool: { enabled: false, keywordTags: [] },
      },
    });
    const h = harness({ settings: { masterEnabled: true, apps: [stored] } });
    const changed = await h.service.reconcileFromToolList('app-ha', ['get_status', 'new_tool']);
    expect(changed).toBe(true);
    const toolState = h.readSettings().apps[0].toolState;
    expect(toolState['vanished_tool']).toBeUndefined();
    expect(toolState['new_tool']).toBeUndefined();
    expect(toolState['get_status']).toBeDefined();
  });

  it('skips reconciliation without a cached snapshot (fresh boot never prunes)', async () => {
    const stored = app({ toolState: { get_status: { enabled: true, keywordTags: [] } } });
    const h = harness({ settings: { masterEnabled: true, apps: [stored] } });
    await h.service.boot();
    expect(h.readSettings().apps[0].toolState['get_status']).toBeDefined();
  });

  it('marks new (stateless) tools in the view for UI surfacing', async () => {
    const stored = app({ toolState: { get_status: { enabled: true, keywordTags: [] } } });
    const h = harness({
      settings: { masterEnabled: true, apps: [stored] },
      cached: { 'srv-ha': ['get_status', 'brand_new'] },
    });
    const state = await h.service.getState();
    expect(state[0].knownTools).toEqual([
      { name: 'get_status', description: '', state: { enabled: true, keywordTags: [] } },
      { name: 'brand_new', description: '', state: null },
    ]);
  });

  it('reconciles by backing server id (runtime state is server-keyed)', async () => {
    const stored = app({
      id: 'app-custom',
      sources: [{ kind: 'mcp', server: mcpServer({ id: 'srv-custom' }) }],
      toolState: { old_tool: { enabled: true, keywordTags: [] } },
    });
    const h = harness({ settings: { masterEnabled: true, apps: [stored] } });
    const changed = await h.service.reconcileFromToolList('srv-custom', ['get_status']);
    expect(changed).toBe(true);
    expect(h.readSettings().apps[0].toolState['old_tool']).toBeUndefined();
  });
});

describe('AppService MCP substrate bridge', () => {
  it('returns empty server list when the master switch is off', () => {
    const h = harness({ settings: { masterEnabled: false, apps: [app()] } });
    expect(h.service.listServerConfigs()).toEqual([]);
  });

  it('propagates app enable state onto the server config', () => {
    const disabled = app({ enabled: false });
    const native = app({
      id: 'app-native',
      name: 'Desktop',
      sources: [{ kind: 'native-group', tools: ['screen_capture'] }],
    });
    const h = harness({ settings: { masterEnabled: true, apps: [app(), disabled, native] } });
    const servers = h.service.listServerConfigs();
    expect(servers).toHaveLength(2);
    expect(new Set(servers.map((server) => server.enabled))).toEqual(new Set([true, false]));
  });

  it('translates namespaced overrides through toolState', () => {
    const toolState: Record<string, ToolAppToolState> = {
      control: { enabled: false, keywordTags: [], baseRisk: 'state-changing' },
      get_status: { enabled: true, keywordTags: [], baseRisk: 'read-only', riskOverride: 'state-changing' },
    };
    const h = harness({ settings: { masterEnabled: true, apps: [app({ toolState })] } });
    expect(h.service.toolOverrideFor('mcp__homeassistant__control')).toEqual({ enabled: false, risk: 'state-changing' });
    expect(h.service.toolOverrideFor('mcp__homeassistant__get_status')).toEqual({ risk: 'state-changing' });
    expect(h.service.toolOverrideFor('mcp__homeassistant__unknown')).toBeUndefined();
    expect(h.service.toolOverrideFor('mcp__other__control')).toBeUndefined();
  });

  it('reads connection secrets from the owning app keyring namespace', async () => {
    const custom = app({
      id: 'app-custom',
      sources: [{ kind: 'mcp', server: mcpServer({ id: 'srv-custom' }) }],
    });
    const h = harness({ settings: { masterEnabled: true, apps: [custom] } });
    h.secrets.set(appEnvSecretKey('app-custom'), JSON.stringify({ TOKEN: 'abc' }));
    const secretsForServer = await h.service.readServerSecrets('srv-custom');
    expect(secretsForServer.env).toEqual({ TOKEN: 'abc' });
  });
});

describe('AppService CRUD (renderer input untrusted)', () => {
  it('saves a valid app, stores secrets, and keeps them out of config', async () => {
    const h = harness();
    const result = await h.service.saveApp({
      ...app(),
      env: { TOKEN: 'super-secret' },
      headers: { Authorization: 'Bearer token' },
    });
    expect(result.ok).toBe(true);
    expect(h.readSettings().apps).toHaveLength(1);
    expect(JSON.stringify(h.readSettings())).not.toContain('super-secret');
    expect(JSON.stringify(h.readSettings())).not.toContain('Bearer token');
  });

  it('strips renderer-authored baseRisk values (D4 — tighten-only surface)', async () => {
    const h = harness();
    const result = await h.service.saveApp({
      ...app(),
      toolState: { control: { enabled: true, keywordTags: [], baseRisk: 'read-only' } },
    });
    expect(result.ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['control']).toEqual({ enabled: true, keywordTags: [] });
    const loosen = await h.service.setToolState('app-ha', 'control', { riskOverride: 'read-only' });
    expect(loosen.ok).toBe(false);
  });

  it('keeps stored authored baselines through renderer saves', async () => {
    const stored = app({
      toolState: { get_status: { enabled: true, keywordTags: [], baseRisk: 'read-only' } },
    });
    const h = harness({ settings: { masterEnabled: true, apps: [stored] } });
    const result = await h.service.saveApp({
      ...stored,
      toolState: { get_status: { enabled: true, keywordTags: ['status'] } },
    });
    expect(result.ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['get_status']).toEqual({
      enabled: true,
      keywordTags: ['status'],
      baseRisk: 'read-only',
    });
  });

  it('rejects a duplicate backing server name', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    const result = await h.service.saveApp(app({ id: 'app-two', name: 'Second HA' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('duplicate backing server name');
    }
  });

  it('rejects unknown toolState tools against the known snapshot', async () => {
    const h = harness({
      settings: { masterEnabled: true, apps: [app()] },
      cached: { 'srv-ha': ['get_status'] },
    });
    const result = await h.service.saveApp(app({ toolState: { ghost_tool: { enabled: true, keywordTags: [] } } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ghost_tool');
    }
  });

  it('generates an id when the renderer sends none', async () => {
    const h = harness();
    const result = await h.service.saveApp({ ...app(), id: '' });
    expect(result.ok).toBe(true);
    expect(h.readSettings().apps[0].id).toBe('generated-id');
  });

  it('removes an app together with its keyring blobs (no orphaned tokens)', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    h.secrets.set(appEnvSecretKey('app-ha'), JSON.stringify({ TOKEN: 'abc' }));
    h.secrets.set(appHeaderSecretKey('app-ha'), JSON.stringify({ H: '1' }));
    h.secrets.set('mcp:app-ha:env', 'legacy');
    const result = await h.service.removeApp('app-ha');
    expect(result.ok).toBe(true);
    expect(h.readSettings().apps).toHaveLength(0);
    expect(h.secrets.has(appEnvSecretKey('app-ha'))).toBe(false);
    expect(h.secrets.has(appHeaderSecretKey('app-ha'))).toBe(false);
    expect(h.secrets.has('mcp:app-ha:env')).toBe(false);
    expect(h.readConnectionResets()).toBe(1);
    expect((await h.service.removeApp('app-ha')).ok).toBe(false);
  });

  it('rejects loosening risk overrides through setToolState', async () => {
    const stored = app({
      toolState: { control: { enabled: true, keywordTags: [], baseRisk: 'state-changing' } },
    });
    const h = harness({ settings: { masterEnabled: true, apps: [stored] } });
    expect((await h.service.setToolState('app-ha', 'control', { riskOverride: 'read-only' })).ok).toBe(false);
    expect((await h.service.setToolState('app-ha', 'control', { riskOverride: 'destructive' })).ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['control'].riskOverride).toBe('destructive');
    expect((await h.service.setToolState('app-ha', 'control', null)).ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['control']).toBeUndefined();
  });

  it('blocks re-enabling a validation-disabled app', async () => {
    const errored = app({ enabled: false, error: 'broken manifest' });
    const h = harness({ settings: { masterEnabled: true, apps: [errored] } });
    expect((await h.service.setAppEnabled('app-ha', true)).ok).toBe(false);
  });

  it('toggles the master switch without touching apps', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    await h.service.setMasterEnabled(false);
    expect(h.readSettings().masterEnabled).toBe(false);
    expect(h.readSettings().apps).toHaveLength(1);
  });
});

describe('AppService mcp:* compat surface (retires in S5)', () => {
  it('maps server views over enabled apps with masked secrets', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    h.secrets.set(appEnvSecretKey('app-ha'), JSON.stringify({ TOKEN: 'abc', OTHER: 'x' }));
    const views = await h.service.mcpServerViews();
    expect(views).toHaveLength(1);
    expect(views[0].config.id).toBe('srv-ha');
    expect(views[0].envKeys).toEqual(['TOKEN', 'OTHER']);
    expect(JSON.stringify(views)).not.toContain('abc');
  });

  it('saves a legacy server payload as a custom app and keeps existing toolState', async () => {
    const existing = app({
      toolState: { control: { enabled: false, keywordTags: ['lights'] } },
    });
    const h = harness({ settings: { masterEnabled: true, apps: [existing] } });
    await h.service.saveMcpServer({ ...mcpServer(), env: { TOKEN: 'next' } });
    const settings = h.readSettings();
    expect(settings.apps).toHaveLength(1);
    expect(settings.apps[0].toolState['control']).toEqual({ enabled: false, keywordTags: ['lights'] });
    expect(settings.apps[0].name).toBe('Home Assistant');
  });

  it('translates legacy tool overrides, preserving plan-11 semantics', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    expect((await h.service.setMcpToolOverride('mcp__homeassistant__control', { risk: 'read-only', enabled: true })).ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['control']).toEqual({ enabled: true, keywordTags: [], baseRisk: 'read-only' });
    expect((await h.service.setMcpToolOverride('mcp__homeassistant__control', null)).ok).toBe(true);
    expect(h.readSettings().apps[0].toolState['control']).toBeUndefined();
    expect((await h.service.setMcpToolOverride('mcp__unknown__tool', { enabled: true })).ok).toBe(false);
  });
});

describe('tool-cache TTL refresh (plan-15 polish)', () => {
  it('refreshes enabled app snapshots older than the TTL on getState', async () => {
    const h = harness({
      settings: { masterEnabled: true, apps: [app()] },
      cacheAges: { 'srv-ha': TOOL_CACHE_TTL_MS + 1 },
    });
    await h.service.getState();
    expect(h.refreshedServers).toEqual(['srv-ha']);
  });

  it('treats a never-fetched cache as stale', async () => {
    const h = harness({ settings: { masterEnabled: true, apps: [app()] } });
    await h.service.getState();
    expect(h.refreshedServers).toEqual(['srv-ha']);
  });

  it('skips fresh caches, disabled apps and native-group apps', async () => {
    const native = app({ id: 'app-native', name: 'Desktop', sources: [{ kind: 'native-group', tools: ['screen_capture'] }] });
    const h = harness({
      settings: { masterEnabled: true, apps: [app(), app({ id: 'app-off', name: 'Off', enabled: false }), native] },
      cacheAges: { 'srv-ha': TOOL_CACHE_TTL_MS - 1 },
    });
    await h.service.getState();
    expect(h.refreshedServers).toEqual([]);
  });

  it('does not double-refresh while in flight and swallows refresh failures', async () => {
    let release!: () => void;
    const h = harness({
      settings: { masterEnabled: true, apps: [app()] },
      cacheAges: { 'srv-ha': null },
    });
    h.holdRefresh(new Promise<void>((resolve) => {
      release = resolve;
    }));
    h.refreshGates.set('srv-ha', 'reject');
    const first = h.service.getState();
    await h.service.getState();
    expect(h.refreshedServers).toEqual([]);
    release();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.refreshedServers).toEqual(['srv-ha']);
  });
});

describe('per-app usage attribution (plan-15 polish)', () => {
  it('attributes MCP tool calls to the owning app and native-group tools to their app', () => {
    const native = app({ id: 'app-native', name: 'Desktop', sources: [{ kind: 'native-group', tools: ['screen_capture'] }] });
    const h = harness({ settings: { masterEnabled: true, apps: [app(), native] } });
    expect(h.service.appDisplayNameForTool('anything', 'homeassistant')).toBe('Home Assistant');
    expect(h.service.appDisplayNameForTool('mcp__homeassistant__control', null)).toBe('Home Assistant');
    expect(h.service.appDisplayNameForTool('screen_capture', null)).toBe('Desktop');
    expect(h.service.appDisplayNameForTool('run_shell', null)).toBeNull();
    expect(h.service.appDisplayNameForTool('mcp__other__tool', null)).toBeNull();
  });
});
