import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { AIMessage } from '@langchain/core/messages';
import { McpManager, type McpSecrets } from '@main/ai/tools/mcp';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { createAssistantRunner, type AssistantEvent } from '@main/ai/graphs/assistant';
import type { McpServerConfig } from '@shared/mcp';
import type { LLMProvider } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

const FIXTURE = join(__dirname, 'fixtures', 'mcp-stdio-server.mjs');

const serverConfig = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: 'fx',
  name: 'fixture',
  transport: { type: 'stdio', command: process.execPath, args: [FIXTURE] },
  enabled: true,
  defaultAction: 'allow',
  ...overrides,
});

function makeManager(servers: McpServerConfig[], overrides: Record<string, { enabled?: boolean; risk?: 'read-only' | 'state-changing' | 'destructive' }> = {}) {
  const secrets: Record<string, McpSecrets> = { fx: { env: { FIXTURE_TOKEN: 'secret-value-123' } } };
  return new McpManager({
    listServers: () => servers,
    toolOverrides: (name) => overrides[name],
    readSecrets: async (serverId) => secrets[serverId] ?? {},
  });
}

const noPolicy = { isDisabled: () => false };

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

const provider = { id: 'p1', systemPrompt: '' } as unknown as LLMProvider;

const mcpFixtureServers: McpServerConfig[] = [];

afterAll(async () => {
  // managers close their own children per test; nothing global to reap
});

describe('McpManager', () => {
  it('connects to the stdio fixture, namespaces tools, and passes keyring env', async () => {
    const manager = makeManager([serverConfig()]);
    try {
      const tools = await manager.getAllTools(noPolicy);
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(['mcp__fixture__echo_text', 'mcp__fixture__reveal_env', 'mcp__fixture__slow_tool']);
      expect(tools.every((tool) => tool.risk === 'state-changing')).toBe(true);
      expect(tools.every((tool) => tool.server === 'fixture')).toBe(true);

      const echo = tools.find((tool) => tool.name === 'mcp__fixture__echo_text')!;
      const result = (await echo.tool.invoke({ text: 'hello' })) as string;
      expect(result).toBe('ECHO:hello');

      const reveal = tools.find((tool) => tool.name === 'mcp__fixture__reveal_env')!;
      const envResult = (await reveal.tool.invoke({})) as string;
      expect(envResult).toBe('token-present');

      const status = manager.statusFor('fx');
      expect(status.state).toBe('connected');
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await manager.close();
    }
  }, 30_000);

  it('applies the server kill switch, allowlist, defaultAction deny, and per-tool overrides', async () => {
    const disabled = makeManager([serverConfig()]);
    expect(await disabled.getAllTools({ isDisabled: (name) => name === 'mcp__fixture' })).toEqual([]);
    await disabled.close();

    const allowlisted = makeManager([serverConfig({ allowlist: ['echo_text'] })]);
    const allowTools = await allowlisted.getAllTools(noPolicy);
    expect(allowTools.map((tool) => tool.name)).toEqual(['mcp__fixture__echo_text']);
    await allowlisted.close();

    const denyAll = makeManager([serverConfig({ defaultAction: 'deny' })]);
    expect(await denyAll.getAllTools(noPolicy)).toEqual([]);
    await denyAll.close();

    const overridden = makeManager([serverConfig()], { mcp__fixture__slow_tool: { enabled: false } });
    const overrideTools = await overridden.getAllTools(noPolicy);
    expect(overrideTools.map((tool) => tool.name)).not.toContain('mcp__fixture__slow_tool');
    await overridden.close();

    const risky = makeManager([serverConfig()], { mcp__fixture__echo_text: { risk: 'read-only' } });
    const riskyTools = await risky.getAllTools(noPolicy);
    expect(riskyTools.find((tool) => tool.name === 'mcp__fixture__echo_text')?.risk).toBe('read-only');
    await risky.close();
  }, 60_000);

  it('times out a slow tool without killing the caller', async () => {
    const manager = makeManager([serverConfig({ timeoutMs: 500 })]);
    try {
      const tools = await manager.getAllTools(noPolicy);
      const slow = tools.find((tool) => tool.name === 'mcp__fixture__slow_tool')!;
      const result = (await slow.tool.invoke({})) as string;
      expect(result).toContain('timed out');
    } finally {
      await manager.close();
    }
  }, 30_000);

  it('degrades a crashed server alone and reports the error status', async () => {
    const broken = serverConfig({ id: 'bad', name: 'bad', transport: { type: 'stdio', command: process.execPath, args: ['-e', 'process.exit(1)'] } });
    const healthy = serverConfig();
    const manager = makeManager([broken, healthy]);
    try {
      const tools = await manager.getAllTools(noPolicy);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((tool) => tool.serverId !== 'bad')).toBe(true);
      const badStatus = manager.statusFor('bad');
      expect(badStatus.state).toBe('error');
      expect(badStatus.lastError).toBeTruthy();
    } finally {
      await manager.close();
    }
  }, 60_000);

  it('testConnection reports latency and tool count', async () => {
    const manager = makeManager([serverConfig()]);
    try {
      const result = await manager.testConnection(serverConfig());
      expect(result.ok).toBe(true);
      expect(result.toolCount).toBe(3);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      const missing = await manager.testConnection(
        serverConfig({ id: 'nope', transport: { type: 'stdio', command: process.execPath, args: ['-e', 'process.exit(1)'] } })
      );
      expect(missing.ok).toBe(false);
      expect(missing.error).toBeTruthy();
    } finally {
      await manager.close();
    }
  }, 60_000);
});

describe('MCP tools through the agent (e2e)', () => {
  it('runs a fixture MCP tool end to end inside the tool agent', async () => {
    const manager = makeManager([serverConfig()]);
    const registry = new ToolRegistry();
    const engine = new ToolPolicyEngine(() => ({ toolGrants: {}, disabledTools: [], grantedRoots: [] }));
    engine.grantSession('mcp__fixture__echo_text');

    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'mcp__fixture__echo_text', args: { text: 'via-mcp' } }] }),
      new AIMessage({ content: 'The fixture answered.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine, mcp: manager });
    expect(await runner.getToolCount()).toBe(3);

    const events = await collect(
      runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [{ role: 'user', content: 'call the fixture' }], threadId: 'conv_mcp:turn_1' })
    );
    await manager.close();

    expect(events.some((event) => event.type === 'interrupt')).toBe(false);
    const results = events
      .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
      .flatMap((event) => event.results);
    expect(results).toEqual([{ id: 'call_1', summary: 'ECHO:via-mcp', isError: false, content: 'ECHO:via-mcp' }]);
    expect(events.at(-1)).toMatchObject({ type: 'final', text: 'The fixture answered.' });

    const calls = events.find((event) => event.type === 'tool_calls') as Extract<AssistantEvent, { type: 'tool_calls' }>;
    expect(calls.calls[0]).toMatchObject({ name: 'mcp__fixture__echo_text', risk: 'state-changing', server: 'fixture' });
  }, 60_000);

  it('interrupts an ungranted MCP tool call before execution', async () => {
    const manager = makeManager([serverConfig({ allowlist: ['echo_text'] })]);
    const registry = new ToolRegistry();
    const engine = new ToolPolicyEngine(() => ({ toolGrants: {}, disabledTools: [], grantedRoots: [] }));

    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'mcp__fixture__echo_text', args: { text: 'x' } }] }),
      new AIMessage({ content: 'done' }),
    ]);
    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine, mcp: manager });

    const first = await collect(
      runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [], threadId: 'conv_mcp:turn_2' })
    );
    await manager.close();
    const interrupts = first.filter((event): event is Extract<AssistantEvent, { type: 'interrupt' }> => event.type === 'interrupt');
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0].requests[0]).toMatchObject({
      toolName: 'mcp__fixture__echo_text',
      risk: 'state-changing',
      allowedDecisions: ['approve', 'reject'],
    });
    expect(first.some((event) => event.type === 'tool_results')).toBe(false);
  }, 60_000);
});
