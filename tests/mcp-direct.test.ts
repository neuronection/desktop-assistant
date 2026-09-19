import { describe, it, expect, vi } from 'vitest';
import type { ToolAppSpec } from '@shared/apps';
import {
  McpDirectExecutor,
  buildMcpDirectTools,
  executeMcpDirect,
  mcpEntityGuard,
  type McpDirectDeps,
  type McpDirectTool,
} from '@main/ai/tools/mcp-direct';

function appSpec(overrides: Partial<ToolAppSpec> = {}): ToolAppSpec {
  return {
    id: 'app-ha',
    name: 'Home Assistant',
    enabled: true,
    sources: [{ kind: 'mcp', server: { id: 'srv-1', name: 'homeassistant', enabled: true } }] as ToolAppSpec['sources'],
    toolState: {
      control: { enabled: true, keywordTags: [], baseRisk: 'state-changing', entityRole: 'action', entityArg: 'entity_id' },
      get_status: { enabled: true, keywordTags: [], baseRisk: 'read-only' },
      dangerous: { enabled: true, keywordTags: [], baseRisk: 'destructive' },
      disabled_tool: { enabled: false, keywordTags: [] },
    },
    entityScope: { rules: [{ effect: 'deny', pattern: '*' }, { effect: 'allow', pattern: 'light.*' }] },
    exposure: 'always',
    ...overrides,
  } as ToolAppSpec;
}

function deps(overrides: Partial<McpDirectDeps> = {}): McpDirectDeps {
  return {
    apps: () => [appSpec()],
    manager: {
      statusFor: () => ({ state: 'connected' }),
      cachedToolsFor: () => [
        { namespaced: 'mcp__homeassistant__control', rawName: 'control' },
        { namespaced: 'mcp__homeassistant__get_status', rawName: 'get_status' },
        { namespaced: 'mcp__homeassistant__dangerous', rawName: 'dangerous' },
        { namespaced: 'mcp__homeassistant__disabled_tool', rawName: 'disabled_tool' },
      ],
      getToolsForServer: async () => [
        { name: 'mcp__homeassistant__control', tool: { invoke: async (args) => `controlled ${JSON.stringify(args)}` } },
        { name: 'mcp__homeassistant__get_status', tool: { invoke: async () => 'status ok' } },
        { name: 'mcp__homeassistant__dangerous', tool: { invoke: async () => 'boom' } },
        { name: 'mcp__homeassistant__disabled_tool', tool: { invoke: async () => 'nope' } },
      ],
    },
    policy: { isDisabled: () => false },
    ...overrides,
  };
}

describe('buildMcpDirectTools', () => {
  it('projects connected app tools, dropping destructive and disabled', async () => {
    const tools = await buildMcpDirectTools(deps());
    expect(tools.map((tool) => tool.namespaced)).toEqual([
      'mcp__homeassistant__control',
      'mcp__homeassistant__get_status',
    ]);
    expect(tools[0]).toMatchObject({ risk: 'state-changing', entityArg: 'entity_id', appName: 'Home Assistant' });
  });

  it('skips disconnected servers', async () => {
    const tools = await buildMcpDirectTools(
      deps({ manager: { ...deps().manager, statusFor: () => ({ state: 'disconnected' }) } })
    );
    expect(tools).toEqual([]);
  });
});

describe('mcpEntityGuard (D18)', () => {
  const tool: McpDirectTool = {
    namespaced: 'mcp__homeassistant__control',
    rawName: 'control',
    appName: 'Home Assistant',
    enabled: true,
    risk: 'state-changing',
    entityArg: 'entity_id',
    scopeRules: [
      { effect: 'deny', pattern: '*' },
      { effect: 'allow', pattern: 'light.*' },
    ],
    invoke: async () => 'ok',
  };

  it('allows in-scope entities and rejects out-of-scope ones', () => {
    expect(mcpEntityGuard(tool, { entity_id: 'light.kitchen' })).toBeNull();
    expect(mcpEntityGuard(tool, { entity_id: 'lock.front_door' })).toContain('entity scope');
  });

  it('passes when there is no scope, no entityArg, or no entity value', () => {
    expect(mcpEntityGuard({ ...tool, scopeRules: undefined }, { entity_id: 'lock.x' })).toBeNull();
    expect(mcpEntityGuard({ ...tool, entityArg: undefined }, { entity_id: 'lock.x' })).toBeNull();
    expect(mcpEntityGuard(tool, {})).toBeNull();
    expect(mcpEntityGuard(tool, { entity_id: 42 })).toBeNull();
  });
});

describe('executeMcpDirect', () => {
  it('invokes and extracts text', async () => {
    const tool: McpDirectTool = {
      namespaced: 'mcp__homeassistant__control',
      rawName: 'control',
      appName: 'HA',
      enabled: true,
      risk: 'state-changing',
      invoke: async (args) => [{ type: 'text', text: `done ${JSON.stringify(args)}` }, { type: 'image', url: 'data:image/png;base64,x' }],
    };
    const outcome = await executeMcpDirect(tool, { entity_id: 'light.kitchen' });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('done');
    expect(outcome.images).toEqual(['data:image/png;base64,x']);
  });

  it('rejects out-of-scope entities without invoking', async () => {
    const invoke = vi.fn(async () => 'should not run');
    const tool: McpDirectTool = {
      namespaced: 'mcp__homeassistant__control',
      rawName: 'control',
      appName: 'HA',
      enabled: true,
      risk: 'state-changing',
      entityArg: 'entity_id',
      scopeRules: [{ effect: 'deny', pattern: '*' }],
      invoke,
    };
    const outcome = await executeMcpDirect(tool, { entity_id: 'lock.front_door' });
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('entity scope');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps invoke failures to error outcomes', async () => {
    const tool: McpDirectTool = {
      namespaced: 'mcp__homeassistant__control',
      rawName: 'control',
      appName: 'HA',
      enabled: true,
      risk: 'state-changing',
      invoke: async () => {
        throw new Error('server down');
      },
    };
    const outcome = await executeMcpDirect(tool, {});
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('server down');
  });
});

describe('McpDirectExecutor', () => {
  it('executes a namespaced tool through the snapshot', async () => {
    const executor = new McpDirectExecutor(deps());
    expect(await executor.riskFor('mcp__homeassistant__control')).toBe('state-changing');
    expect(await executor.riskFor('mcp__homeassistant__missing')).toBeUndefined();
    expect(await executor.riskFor('web_search')).toBeUndefined();
    const outcome = await executor.execute('mcp__homeassistant__get_status', {});
    expect(outcome).toMatchObject({ ok: true, text: 'status ok' });
    expect(await executor.execute('mcp__homeassistant__nope', {})).toMatchObject({ ok: false });
  });
});

import { snapshotDecisionMcpTools } from '@main/ai/tools/mcp-direct';

describe('snapshotDecisionMcpTools (cache warming)', () => {
  const base = () => deps();

  it('warms a cold cache via listServerTools and projects rows', async () => {
    const listServerTools = vi.fn(async () => [
      { namespaced: 'mcp__homeassistant__HassTurnOn', rawName: 'HassTurnOn', description: 'Turns on a light.', parameters: [{ name: 'area', type: 'string', required: false }] },
    ]);
    const manager = { ...base().manager, cachedToolsFor: () => [], listServerTools };
    const rows = await snapshotDecisionMcpTools({ ...base(), manager });
    expect(listServerTools).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'mcp__homeassistant__HassTurnOn', priority: true });
    expect(rows[0]?.parameterList).toHaveLength(1);
  });

  it('skips fail-soft when the warm listing exceeds the timeout', async () => {
    const listServerTools = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 5_000))
    ) as unknown as NonNullable<McpDirectDeps['manager']['listServerTools']>;
    const manager = { ...base().manager, cachedToolsFor: () => [], listServerTools };
    const rows = await snapshotDecisionMcpTools({ ...base(), manager }, 30);
    expect(rows).toEqual([]);
  });

  it('does not re-list a warm, connected cache', async () => {
    const listServerTools = vi.fn(async () => []);
    const manager = {
      ...base().manager,
      listServerTools,
    };
    await snapshotDecisionMcpTools({ ...base(), manager });
    expect(listServerTools).not.toHaveBeenCalled();
  });
});

describe('MCP error-text results', () => {
  it('maps Error (tool): text to a failed outcome (triggers agent repair)', async () => {
    const tool: McpDirectTool = {
      namespaced: 'mcp__homeassistant__light__HassLightSet',
      rawName: 'light__HassLightSet',
      appName: 'Home Assistant',
      enabled: true,
      risk: 'state-changing',
      invoke: async () => "Error (mcp__homeassistant__light__HassLightSet): MCP tool 'light__HassLightSet' returned an error: MatchFailedError",
    };
    const outcome = await executeMcpDirect(tool, { name: 'lights', area: 'office' });
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('MatchFailedError');
  });

  it('keeps successful text results ok', async () => {
    const tool: McpDirectTool = {
      namespaced: 'mcp__homeassistant__get_state',
      rawName: 'get_state',
      appName: 'Home Assistant',
      enabled: true,
      risk: 'read-only',
      invoke: async () => 'Office light is on.',
    };
    const outcome = await executeMcpDirect(tool, {});
    expect(outcome.ok).toBe(true);
  });
});
