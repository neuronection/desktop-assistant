import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { AIMessage } from '@langchain/core/messages';
import { McpManager } from '@main/ai/tools/mcp';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { createAssistantRunner, CONVERSATION_STATE_LIMIT, type AssistantEvent, type AssistantRunnerDeps } from '@main/ai/graphs/assistant';
import type { ToolAppSpec } from '@shared/apps';
import type { McpServerConfig } from '@shared/mcp';
import type { LLMProvider } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

const FIXTURE = join(__dirname, 'fixtures', 'mcp-stdio-server.mjs');

const serverConfig = (): McpServerConfig => ({
  id: 'fx',
  name: 'fixture',
  transport: { type: 'stdio', command: process.execPath, args: [FIXTURE] },
  enabled: true,
  defaultAction: 'allow',
});

const haApp = (): ToolAppSpec => ({
  id: 'app-fixture',
  name: 'Fixture App',
  description: 'A fixture app for tests',
  enabled: true,
  sources: [{ kind: 'mcp', server: serverConfig() }],
  toolState: { echo_text: { enabled: true, keywordTags: ['echo', 'repeat'] } },
  exposure: 'relevance',
});

const policy = () =>
  new ToolPolicyEngine(() => ({
    toolGrants: {},
    disabledTools: [],
    grantedRoots: [],
    toolSettings: {},
    classDefaults: {},
  }));

function makeRunner(models: ScriptedChatModel[], apps: ToolAppSpec[], appContext?: (appIds?: string[]) => Promise<string | null>) {
  const manager = new McpManager({
    listServers: () => apps.flatMap((app) => (app.sources[0].kind === 'mcp' ? [app.sources[0].server] : [])),
    toolOverrides: () => undefined,
    readSecrets: async () => ({}),
  });
  let modelIndex = 0;
  const deps: AssistantRunnerDeps = {
    registry: new ToolRegistry(),
    policy: policy(),
    mcp: manager,
    apps: { listEnabled: async () => apps, budget: async () => 25, ...(appContext ? { appContext } : {}) },
    createModel: () => models[Math.min(modelIndex++, models.length - 1)],
  };
  const runner = createAssistantRunner(deps);
  const provider = { id: 'p1', systemPrompt: '' } as unknown as LLMProvider;
  const close = () => manager.close();
  return { runner, provider, close };
}

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

describe('plan 15 S2 trajectories (fixture MCP app)', () => {
  it('a relevant query binds app tools, raises the approval card, and resume executes (D14)', async () => {
    const history = [{ role: 'user', content: 'please echo hello world' }];
    const { runner, provider, close } = makeRunner(
      [
        new ScriptedChatModel([
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'call_1', name: 'mcp__fixture__echo_text', args: { text: 'hello world' } }],
          }),
        ]),
        new ScriptedChatModel([new AIMessage({ content: 'resumed done' })]),
      ],
      [haApp()]
    );
    try {
      const first = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history,
          threadId: 'conv:1',
        })
      );
      const selection = first.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string; toolNames: string[] }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('match');
      expect(selection?.decisions[0]?.toolNames).toContain('mcp__fixture__echo_text');
      const interrupt = first.find((event) => event.type === 'interrupt') as
        | { requests: { toolName: string; id: string }[] }
        | undefined;
      expect(interrupt?.requests[0]?.toolName).toBe('mcp__fixture__echo_text');
      expect(first.some((event) => event.type === 'tool_results')).toBe(false);

      const second = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history,
          threadId: 'conv:1',
          resume: [{ id: interrupt?.requests[0]?.id ?? 'appr_0', type: 'approve' }],
        })
      );
      const resumeSelection = second.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(resumeSelection?.decisions[0]?.reason).toBe('match');
      const toolResult = second.find((event) => event.type === 'tool_results') as
        | { results: { summary: string }[] }
        | undefined;
      expect(toolResult?.results[0]?.summary).toContain('ECHO:hello world');
      expect(second.at(-1)).toMatchObject({ type: 'final', text: 'resumed done' });
    } finally {
      await close();
    }
  });

  it('a matcher miss leaves the app unbound and rejected tool calls degrade honestly (wrapToolCall guard)', async () => {
    const history = [{ role: 'user', content: 'tell me a joke' }];
    const { runner, provider, close } = makeRunner(
      [
        new ScriptedChatModel([
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'call_1', name: 'mcp__fixture__echo_text', args: { text: 'hi' } }],
          }),
          new AIMessage({ content: 'cannot use that app this turn' }),
        ]),
      ],
      [haApp()]
    );
    try {
      const events = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history,
          threadId: 'conv:2',
        })
      );
      const selection = events.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('no-match');
      expect(events.some((event) => event.type === 'interrupt')).toBe(false);
      const toolResult = events.find((event) => event.type === 'tool_results') as
        | { results: { summary: string }[] }
        | undefined;
      expect(toolResult?.results[0]?.summary).toContain('was not selected for this turn');
      expect(events.at(-1)).toMatchObject({ type: 'final', text: 'cannot use that app this turn' });
    } finally {
      await close();
    }
  });

  it('router: the agent enables an app mid-turn via enable_app and its tools execute', async () => {
    const { runner, provider, close } = makeRunner(
      [
        new ScriptedChatModel([
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'call_0', name: 'enable_app', args: { app: 'Fixture App' } }],
          }),
          new AIMessage({
            content: '',
            tool_calls: [{ id: 'call_1', name: 'mcp__fixture__echo_text', args: { text: 'routed' } }],
          }),
          new AIMessage({ content: 'routed done' }),
        ]),
      ],
      [haApp()]
    );
    try {
      const events = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'zzz qqq unrelated' }],
          threadId: 'conv:router',
        })
      );
      const results = events.filter((event) => event.type === 'tool_results') as
        { results: { id: string; summary: string }[] }[];
      const enableResult = results.flatMap((event) => event.results).find((result) => result.id === 'call_0');
      expect(enableResult?.summary).toContain('Enabled Fixture App');
      const echoResult = results.flatMap((event) => event.results).find((result) => result.id === 'call_1');
      expect(echoResult?.summary).toContain('ECHO:routed');
      expect(events.at(-1)).toMatchObject({ type: 'final', text: 'routed done' });
    } finally {
      await close();
    }
  });

  it('D15: the app stays bound on a miss follow-up within the window', async () => {
    const { runner, provider, close } = makeRunner(
      [new ScriptedChatModel([new AIMessage({ content: 'ok' })]), new ScriptedChatModel([new AIMessage({ content: 'ok too' })])],
      [haApp()]
    );
    try {
      await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'echo something' }],
          threadId: 'conv:3',
        })
      );
      const second = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [
            { role: 'user', content: 'echo something' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'now the bedroom too' },
          ],
          threadId: 'conv:3',
        })
      );
      const selection = second.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('sticky');
    } finally {
      await close();
    }
  });

  it('D15: sticky bindings survive across turns when the thread id carries a per-turn suffix', async () => {
    const { runner, provider, close } = makeRunner(
      [new ScriptedChatModel([new AIMessage({ content: 'ok' })])],
      [haApp()]
    );
    try {
      await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'echo something' }],
          threadId: 'conv-sticky:msg-1',
        })
      );
      const second = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [
            { role: 'user', content: 'echo something' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'now the bedroom too' },
          ],
          threadId: 'conv-sticky:msg-2',
        })
      );
      const selection = second.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('sticky');
    } finally {
      await close();
    }
  });

  it('D15: conversation state evicts oldest-first beyond the limit', async () => {
    const { runner, provider, close } = makeRunner(
      [new ScriptedChatModel([new AIMessage({ content: 'ok' })])],
      [haApp()]
    );
    try {
      for (let i = 0; i <= CONVERSATION_STATE_LIMIT; i++) {
        await collect(
          runner.run({
            provider,
            modelId: 'test-model',
            apiKey: 'sk-test',
            history: [{ role: 'user', content: 'echo something' }],
            threadId: `conv-evict-${i}:msg-1`,
          })
        );
      }
      const oldest = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [
            { role: 'user', content: 'echo something' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'now the bedroom too' },
          ],
          threadId: 'conv-evict-0:msg-2',
        })
      );
      const oldestSelection = oldest.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(oldestSelection?.decisions[0]?.reason).toBe('no-match');
      const newest = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [
            { role: 'user', content: 'echo something' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'now the bedroom too' },
          ],
          threadId: `conv-evict-${CONVERSATION_STATE_LIMIT}:msg-2`,
        })
      );
      const newestSelection = newest.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(newestSelection?.decisions[0]?.reason).toBe('sticky');
    } finally {
      await close();
    }
  });
  it('plan 23 S3/S6: app-context rides BOUND apps only — no tokens on unrelated turns', async () => {
    let requestedAppIds: string[] | undefined;
    const scripted = new ScriptedChatModel([new AIMessage({ content: 'ok' })]);
    const { runner, provider, close } = makeRunner(
      [scripted],
      [haApp()],
      async (appIds?: string[]) => {
        requestedAppIds = appIds ?? [];
        return '[App context — Fixture App]\n- light.office — Office Light';
      }
    );
    try {
      let firstErr: unknown;
      try {
        await collect(
          runner.run({
            provider,
            modelId: 'test-model',
            apiKey: 'sk-test',
            // No keyword match with the fixture app → the app must not be bound.
            history: [{ role: 'user', content: 'write a haiku about clouds' }],
            threadId: 'conv:digest-off',
          })
        );
      } catch (error) {
        firstErr = error;
        console.error('DIGEST-OFF TURN ERR', error);
      }
      expect(firstErr).toBeUndefined();
      expect(requestedAppIds).toBeUndefined();
      const system = (scripted.received[0] ?? []).map((message) => message.text).join('\n');
      expect(system).not.toContain('[App context — Fixture App]');
    } finally {
      await close();
    }
    // A matching turn requests the bound app and gets the digest.
    const boundScripted = new ScriptedChatModel([new AIMessage({ content: 'ok' })]);
    const second = makeRunner(
      [boundScripted],
      [haApp()],
      async (appIds?: string[]) => {
        requestedAppIds = appIds;
        return '[App context — Fixture App]\n- light.office — Office Light';
      }
    );
    try {
      await collect(
        second.runner.run({
          provider: second.provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'echo something' }],
          threadId: 'conv:digest-on',
        })
      );
      expect(requestedAppIds).toContain(haApp().id);
      const system = (boundScripted.received[0] ?? []).map((message) => message.text).join('\n');
      expect(system).toContain('[App context — Fixture App]');
      expect(system).toContain('- light.office — Office Light');
    } finally {
      await second.close();
    }
  });
});
