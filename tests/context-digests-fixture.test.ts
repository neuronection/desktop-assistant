import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { ContextDigestService } from '@main/ai/tools/apps/context-digests';
import { homeAssistantDigestProvider } from '@main/ai/tools/apps/context-providers/home-assistant';
import { McpManager } from '@main/ai/tools/mcp';
import type { McpServerConfig } from '@shared/mcp';
import { entityAllowedByScope } from '@main/ai/tools/app-selection';
import type { EntityScopeRule } from '@shared/apps';

const FIXTURE = join(__dirname, 'fixtures', 'mcp-context-server.mjs');

const server: McpServerConfig = {
  id: 'ctx-fixture',
  name: 'homeassistant',
  transport: { type: 'stdio', command: process.execPath, args: [FIXTURE] },
  enabled: true,
  defaultAction: 'allow',
};

const manager = new McpManager({
  listServers: () => [server],
  toolOverrides: () => undefined,
  readSecrets: async () => ({}),
});
const digests = new ContextDigestService({
  listTools: async (server_) =>
    (await manager.getToolsForServer(server_, { isDisabled: () => false })).map((tool) => ({ name: tool.name })),
  invokeTool: async (server_, toolName) => {
    const tool = (await manager.getToolsForServer(server_, { isDisabled: () => false })).find(
      (candidate) => candidate.name === toolName
    );
    return tool ? tool.tool.invoke({}) : null;
  },
});
digests.register('home-assistant', homeAssistantDigestProvider);

afterAll(async () => {
  await manager.close();
});

const rule = (effect: 'allow' | 'deny', pattern: string): EntityScopeRule => ({ effect, pattern }) as EntityScopeRule;

describe('S5 measurement bar: real MCP wire → digest (plan 23)', () => {
  it('discovers the context tool across namespacing and renders the entit digest from one call', async () => {
    const digest = await digests.digestFor({ capability: 'home-assistant', appName: 'Home Assistant', server });
    expect(digest).toBeTruthy();
    expect(digest).toContain('[App context — Home Assistant]');
    expect(digest).toContain('- light.office — Γραφείο');
    expect(digest).toContain('- climate.living_room — Living room thermostat');
  });

  it('serves the cached digest within the TTL without a second server round', async () => {
    const first = await digests.digestFor({ capability: 'home-assistant', appName: 'Home Assistant', server });
    const second = await digests.digestFor({ capability: 'home-assistant', appName: 'Home Assistant', server });
    expect(second).toBe(first);
  });

  it('filters the real digest through entity-scope rules at render (D10)', async () => {
    const filtered = await digests.digestFor({
      capability: 'home-assistant',
      appName: 'Home Assistant',
      server,
      entityAllowed: (id) => entityAllowedByScope(id, [rule('deny', 'switch.*')]),
    });
    expect(filtered).toContain('light.office');
    expect(filtered).not.toContain('switch.plug');
    expect(filtered).toContain('climate.living_room');
  });

  it('unknown apps proceed digest-less (D13)', async () => {
    expect(await digests.digestFor({ capability: 'github', appName: 'GitHub', server })).toBeNull();
  });
});
