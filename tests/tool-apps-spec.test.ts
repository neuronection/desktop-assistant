import { describe, expect, it } from 'vitest';
import {
  migrateMcpServersToToolApps,
  parseToolApp,
  riskTightensOnly,
  type ToolAppSpec,
} from '@shared/apps';
import type { McpServerConfig } from '@shared/mcp';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';

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

describe('tool-app spec validation (plan 15 S1)', () => {
  it('accepts a valid app and defaults exposure', () => {
    const result = parseToolApp({ ...app(), exposure: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.app.exposure).toBe('relevance');
    }
  });

  it('rejects zero or multiple sources (maxItems 1)', () => {
    expect(parseToolApp({ ...app(), sources: [] }).ok).toBe(false);
    const two = parseToolApp({ ...app(), sources: app().sources.concat(app().sources) });
    expect(two.ok).toBe(false);
  });

  it('rejects an unknown exposure', () => {
    const result = parseToolApp({ ...app(), exposure: 'sometimes' as ToolAppSpec['exposure'] });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed entity-scope patterns (D18)', () => {
    const result = parseToolApp({
      ...app(),
      entityScope: { rules: [{ effect: 'deny', pattern: 'lock front door' }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('entity patterns');
    }
  });

  it('accepts well-formed entity-scope patterns', () => {
    const result = parseToolApp({
      ...app(),
      entityScope: { rules: [{ effect: 'allow', pattern: 'light.*' }, { effect: 'deny', pattern: 'lock.*' }] },
    });
    expect(result.ok).toBe(true);
  });

  it('rejects entityScope on native-group apps', () => {
    const native = app({
      sources: [{ kind: 'native-group', tools: ['screen_capture'] }],
      entityScope: { rules: [{ effect: 'deny', pattern: 'lock.*' }] },
    });
    const result = parseToolApp(native);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('entityScope');
    }
  });

  it('rejects a loosening risk override and accepts a tightening one (D4)', () => {
    const loosening = parseToolApp({
      ...app(),
      toolState: { control: { enabled: true, keywordTags: [], baseRisk: 'state-changing', riskOverride: 'read-only' } },
    });
    expect(loosening.ok).toBe(false);

    const tightening = parseToolApp({
      ...app(),
      toolState: { control: { enabled: true, keywordTags: [], baseRisk: 'state-changing', riskOverride: 'destructive' } },
    });
    expect(tightening.ok).toBe(true);
  });

  it('ranks risk classes for the tighten-only rule', () => {
    expect(riskTightensOnly('state-changing', 'destructive')).toBe(true);
    expect(riskTightensOnly('state-changing', 'read-only')).toBe(false);
    expect(riskTightensOnly('read-only', 'state-changing')).toBe(true);
    expect(riskTightensOnly('read-only', 'read-only')).toBe(true);
  });

  it('caps keyword tags', () => {
    const tags = Array.from({ length: 21 }, (_, index) => `tag${index}`);
    const result = parseToolApp({ ...app(), toolState: { get_status: { enabled: true, keywordTags: tags } } });
    expect(result.ok).toBe(false);
  });
});

describe('standalone mcpServers → tool apps migration (plan 15 D11)', () => {
  it('wraps each standalone server as a custom app', () => {
    const [migrated] = migrateMcpServersToToolApps([mcpServer()], {}, []);
    expect(migrated.id).toBe('srv-ha');
    expect(migrated.name).toBe('homeassistant');
    expect(migrated.enabled).toBe(true);
    expect(migrated.exposure).toBe('relevance');
    expect(migrated.sources[0].kind).toBe('mcp');
    if (migrated.sources[0].kind === 'mcp') {
      expect(migrated.sources[0].server.enabled).toBe(true);
    }
    expect(migrated.toolState).toEqual({});
  });

  it('moves legacy namespaced overrides into toolState as authored baselines', () => {
    const migrated = migrateMcpServersToToolApps(
      [mcpServer()],
      {
        'mcp__homeassistant__control': { enabled: false, risk: 'state-changing' },
        'mcp__homeassistant__get_status': { risk: 'read-only' },
        'mcp__other__tool': { risk: 'read-only' },
      },
      []
    );
    expect(migrated[0].toolState['control']).toEqual({ enabled: false, keywordTags: [], baseRisk: 'state-changing' });
    expect(migrated[0].toolState['get_status']).toEqual({ enabled: true, keywordTags: [], baseRisk: 'read-only' });
    expect(migrated[0].toolState['other__tool']).toBeUndefined();
  });

  it('skips servers whose id already exists as an app', () => {
    const migrated = migrateMcpServersToToolApps([mcpServer()], {}, [app({ id: 'srv-ha' })]);
    expect(migrated).toHaveLength(0);
  });

  it('returns nothing for an empty legacy collection', () => {
    expect(migrateMcpServersToToolApps([], {}, [])).toEqual([]);
  });
});

describe('mergeWithDefaults toolApps migration (plan 15 S1)', () => {
  it('migrates legacy tools.mcpServers + mcpToolOverrides into toolApps and drops the old fields', () => {
    const legacy = {
      tools: {
        mcpServers: [mcpServer({ id: 'srv-a', name: 'alpha' })],
        mcpToolOverrides: { 'mcp__alpha__control': { risk: 'read-only' } },
      },
    } as Partial<AppConfig> as AppConfig;
    const merged = mergeWithDefaults(legacy);
    expect(merged.toolApps.apps).toHaveLength(1);
    expect(merged.toolApps.apps[0].id).toBe('srv-a');
    expect(merged.toolApps.apps[0].toolState['control']).toEqual({
      enabled: true,
      keywordTags: [],
      baseRisk: 'read-only',
    });
    expect((merged.tools as Record<string, unknown>).mcpServers).toBeUndefined();
    expect((merged.tools as Record<string, unknown>).mcpToolOverrides).toBeUndefined();
  });

  it('keeps existing toolApps untouched when no legacy servers exist', () => {
    const existing = app({ id: 'app-existing' });
    const merged = mergeWithDefaults({ toolApps: { masterEnabled: false, apps: [existing] } } as Partial<AppConfig>);
    expect(merged.toolApps.masterEnabled).toBe(false);
    expect(merged.toolApps.apps).toEqual([existing]);
  });

  it('seeds defaults when neither section is present', () => {
    const merged = mergeWithDefaults({});
    expect(merged.toolApps).toEqual({ masterEnabled: true, apps: [] });
  });

  it('deduplicates legacy servers against existing apps by id', () => {
    const existing = app({ id: 'srv-a', name: 'kept' });
    const merged = mergeWithDefaults({
      toolApps: { masterEnabled: true, apps: [existing] },
      tools: { mcpServers: [mcpServer({ id: 'srv-a', name: 'alpha' })] },
    } as Partial<AppConfig> as AppConfig);
    expect(merged.toolApps.apps).toHaveLength(1);
    expect(merged.toolApps.apps[0].name).toBe('kept');
  });
});
