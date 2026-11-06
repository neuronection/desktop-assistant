import { describe, expect, it, vi } from 'vitest';
import { AppInstanceStatusService } from '@main/services/AppInstanceStatusService';
import { ToolAppService, type ToolAppServiceDeps } from '@main/services/ToolAppService';
import type { AppInstanceStatusView } from '@shared/status';
import type { ToolAppSpec, ToolAppsSettings } from '@shared/apps';
import type { McpServerStatus } from '@shared/mcp';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';

function app(): ToolAppSpec {
  return {
    id: 'app-gh',
    name: 'GitHub',
    enabled: true,
    sources: [
      {
        kind: 'mcp',
        server: {
          id: 'srv-gh',
          name: 'github',
          transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          enabled: true,
          defaultAction: 'allow',
        },
      },
    ],
    toolState: {},
    exposure: 'relevance',
  };
}

function harness(mcpState: McpServerStatus['state'], lastError: string | null = null) {
  let settings: ToolAppsSettings = { masterEnabled: true, apps: [app()] };
  const statuses = new Map<string, AppInstanceStatusView>();
  const deps: ToolAppServiceDeps = {
    config: (): AppConfig => ({ ...DEFAULT_CONFIG, toolApps: settings }),
    updateToolApps: async (patch) => {
      settings = { ...settings, ...patch };
    },
    nativeToolNames: () => [],
    mcpStatusFor: () => ({ serverId: 'srv-gh', state: mcpState, toolCount: 2, latencyMs: null, lastError, lastConnectedAt: null }),
    cachedMcpToolNames: () => ['search_repositories', 'get_file_contents'],
    cachedMcpToolInfos: (serverId) => [{ name: 'search_repositories', description: '' }, { name: 'get_file_contents', description: '' }].map((info) => info),
    cachedMcpContent: () => ({ resources: [], prompts: [] }),
    listMcpContent: async () => ({ resources: [], prompts: [] }),
    cacheAgeMs: () => 0,
    refreshServerTools: async () => undefined,
    testServer: async () => ({ ok: true, toolCount: 2 }),
    getSecret: async () => null,
    setSecret: async () => undefined,
    deleteSecret: async () => undefined,
    newId: () => 'id',
    resetConnections: async () => undefined,
    appStatus: {
      record: async (input) => {
        const previous = statuses.get(input.appId);
        statuses.set(input.appId, {
          status: input.status,
          lastSuccessAt: input.status === 'ok' ? (input.at ?? 1) : previous?.lastSuccessAt ?? null,
          lastFailureAt: input.status === 'failing' ? (input.at ?? 1) : previous?.lastFailureAt ?? null,
          consecutiveFailures: input.status === 'failing' ? (previous?.consecutiveFailures ?? 0) + 1 : 0,
          lastError: input.error ?? null,
          conditions: [],
        });
      },
      list: async () => new Map(statuses),
    },
  };
  return { service: new ToolAppService(deps), statuses };
}

describe('AppInstanceStatus wiring (plan 38 S1)', () => {
  it('maps MCP error to failing and increments consecutive failures per snapshot', async () => {
    const h = harness('error', 'connect ECONNREFUSED');
    await h.service.boot();
    const first = (await h.service.getState())[0];
    expect(first.instanceStatus).toMatchObject({ status: 'failing', consecutiveFailures: 2, lastError: 'connect ECONNREFUSED' });
    const second = (await h.service.getState())[0];
    expect(second.instanceStatus?.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  it('maps connecting to degraded and disconnected to stale', async () => {
    const connecting = harness('connecting');
    await connecting.service.boot();
    expect((await connecting.service.getState())[0].instanceStatus?.status).toBe('degraded');

    const disconnected = harness('disconnected');
    await disconnected.service.boot();
    expect((await disconnected.service.getState())[0].instanceStatus?.status).toBe('stale');
  });

  it('derives needs-config from a stored app error and needs-secret from secret-ish failures', async () => {
    const h = harness('error', 'missing API key');
    await h.service.boot();
    const view = (await h.service.getState())[0];
    expect(view.instanceStatus?.conditions).toContain('needs-secret');
  });
});

describe('AppInstanceStatusService (plan 36 table + plan 38 vocab)', () => {
  it('upserts ok/failing and increments consecutive failures', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const client = {
      appInstanceStatus: {
        findUnique: vi.fn(async ({ where }: { where: { appId_kind: { appId: string; kind: string } } }) => {
          const key = `${where.appId_kind.appId}:${where.appId_kind.kind}`;
          return rows.get(key) ?? null;
        }),
        upsert: vi.fn(async ({ where, create, update }: { where: { appId_kind: { appId: string; kind: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const key = `${where.appId_kind.appId}:${where.appId_kind.kind}`;
          const next = { ...(rows.get(key) ?? create), ...update };
          rows.set(key, next);
          return next;
        }),
        findMany: vi.fn(async () => [...rows.values()]),
      },
    } as never;
    const service = new AppInstanceStatusService(() => client);
    await service.record({ appId: 'a', kind: 'pack', status: 'ok', at: 1000 });
    expect(await service.get('a', 'pack')).toMatchObject({ status: 'ok', lastSuccessAt: 1000, consecutiveFailures: 0 });
    await service.record({ appId: 'a', kind: 'pack', status: 'failing', error: 'boom', at: 2000 });
    await service.record({ appId: 'a', kind: 'pack', status: 'failing', error: 'boom', at: 3000 });
    expect(await service.get('a', 'pack')).toMatchObject({ status: 'failing', consecutiveFailures: 2, lastFailureAt: 3000, lastError: 'boom' });
    expect((await service.list('pack')).get('a')?.status).toBe('failing');
  });
});
