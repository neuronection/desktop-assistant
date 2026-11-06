import { describe, expect, it, vi } from 'vitest';
import { mcpResourceTool, setMcpResourceProvider, type McpExposedApp } from '@main/ai/tools/native/mcp-resource';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { APP_TOOL_BUDGET, selectApps, type SelectionApp } from '@main/ai/tools/app-selection';
import type { McpServerConfig } from '@shared/mcp';

const server: McpServerConfig = {
  id: 'srv-ha',
  name: 'homeassistant',
  transport: { type: 'http', url: 'http://homeassistant.local:8124/mcp' },
  enabled: true,
  defaultAction: 'allow',
};

const exposed: McpExposedApp = {
  appId: 'app-ha',
  appName: 'Home Assistant',
  server,
  resources: [{ uri: 'ha://docs/automation', name: 'automation-docs' }],
};

function policy(disabledTools: string[] = []): ToolPolicyEngine {
  return new ToolPolicyEngine(() => ({
    toolGrants: {},
    disabledTools,
    grantedRoots: [],
    toolSettings: {},
    classDefaults: {},
  }));
}

describe('mcp_resource tool (plan 43 S3)', () => {
  it('is read-only and kill-switchable like every tool', () => {
    expect(mcpResourceTool.risk).toBe('read-only');
    expect(mcpResourceTool.category).toBe('integrations');
    expect(policy().decision(mcpResourceTool.name, mcpResourceTool.risk)).toBe('run');
    expect(policy([mcpResourceTool.name]).decision(mcpResourceTool.name, mcpResourceTool.risk)).toBe('deny');
  });

  it('reads an exposed resource and labels the content untrusted', async () => {
    const read = vi.fn(async () => ({ ok: true as const, text: 'Resource body.', truncated: false }));
    setMcpResourceProvider({ listExposed: () => [exposed], read });
    try {
      const output = await mcpResourceTool.exec({ app: 'Home Assistant', uri: 'ha://docs/automation' });
      expect(output).toContain('[Untrusted content from Home Assistant');
      expect(output).toContain('Resource body.');
      expect(read).toHaveBeenCalledWith('app-ha', 'ha://docs/automation');
    } finally {
      setMcpResourceProvider(null);
    }
  });

  it('marks a truncated read and refuses apps or URIs that are not exposed', async () => {
    setMcpResourceProvider({
      listExposed: () => [exposed],
      read: async () => ({ ok: true, text: 'AAAA', truncated: true }),
    });
    try {
      const truncated = await mcpResourceTool.exec({ app: 'app-ha', uri: 'ha://docs/automation' });
      expect(truncated).toContain('[truncated at the resource byte budget]');
      expect(await mcpResourceTool.exec({ app: 'Unknown', uri: 'ha://docs/automation' })).toContain(
        'No app exposes resources'
      );
      expect(await mcpResourceTool.exec({ app: 'app-ha', uri: 'ha://secret' })).toContain('does not expose resource');
    } finally {
      setMcpResourceProvider(null);
    }
  });

  it('surfaces a read failure honestly', async () => {
    setMcpResourceProvider({
      listExposed: () => [exposed],
      read: async () => ({ ok: false, error: 'server down' }),
    });
    try {
      expect(await mcpResourceTool.exec({ app: 'app-ha', uri: 'ha://docs/automation' })).toContain(
        'Error reading'
      );
    } finally {
      setMcpResourceProvider(null);
    }
  });
});

describe('mcp_resource selection budget (plan 43 D4)', () => {
  it('counts against the tool budget as a non-app tool — no exemption', () => {
    const app = (order: number): SelectionApp => ({
      id: `app-${order}`,
      name: `App ${order}`,
      exposure: 'relevance',
      order,
      tools: [
        { name: `mcp__srv${order}__echo`, description: 'echo', enabled: true, keywordTags: ['echo'] },
      ],
    });
    const base = {
      apps: [app(0), app(1)],
      query: 'echo',
      totalToolCount: 2,
      nonAppToolCount: 0,
      sticky: { entries: new Map() },
      budget: APP_TOOL_BUDGET,
    };
    // Two matched apps + the mcp_resource non-app tool still fit the budget.
    const fits = selectApps({ ...base, nonAppToolCount: 1 });
    expect(fits.decisions.every((decision) => decision.reason !== 'budget-drop')).toBe(true);
    // Push over the budget with non-app tools (mcp_resource among them) and
    // the app is dropped by the SAME guard — the resource tool buys nothing.
    const overflow = selectApps({ ...base, totalToolCount: 30, nonAppToolCount: 26, budget: 25 });
    expect(overflow.decisions.some((decision) => decision.reason === 'budget-drop')).toBe(true);
  });
});
