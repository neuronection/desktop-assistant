import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { AIMessage } from '@langchain/core/messages';
import { supportsProviderToolSearch } from '@main/ai/chat-models';
import { selectApps, type SelectionApp } from '@main/ai/tools/app-selection';
import { McpManager } from '@main/ai/tools/mcp';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import { createAssistantRunner, type AssistantRunnerDeps } from '@main/ai/graphs/assistant';
import type { ToolAppSpec } from '@shared/apps';
import type { McpServerConfig } from '@shared/mcp';
import type { LLMProvider, LLMProviderType } from '@shared/types';
import { ScriptedChatModel } from './helpers/scripted-model';

const FIXTURE = join(__dirname, 'fixtures', 'mcp-stdio-server.mjs');

describe('provider tool-search capability matrix (plan 15 S3)', () => {
  const provider = (type: LLMProviderType | string, apiBase?: string) =>
    ({ type, apiBase }) as Pick<LLMProvider, 'type' | 'apiBase'>;

  it('admits Anthropic Sonnet 4+/Opus 4+/Haiku 4.5+', () => {
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-sonnet-4-5')).toBe(true);
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-opus-4-8')).toBe(true);
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-haiku-4-5')).toBe(true);
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-opus-4-1')).toBe(true);
  });

  it('rejects older Anthropic families', () => {
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-3-7-sonnet')).toBe(false);
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-haiku-4')).toBe(false);
    expect(supportsProviderToolSearch(provider('anthropic'), 'claude-2.1')).toBe(false);
  });

  it('admits gpt-5.4+ on the real OpenAI API only', () => {
    expect(supportsProviderToolSearch(provider('openai'), 'gpt-5.4')).toBe(true);
    expect(supportsProviderToolSearch(provider('openai'), 'gpt-5.5')).toBe(true);
    expect(supportsProviderToolSearch(provider('openai'), 'gpt-6')).toBe(true);
    expect(supportsProviderToolSearch(provider('openai', 'https://api.openai.com/v1/'), 'gpt-5.4')).toBe(true);
  });

  it('rejects older OpenAI models and third-party OpenAI-compatible base URLs', () => {
    expect(supportsProviderToolSearch(provider('openai'), 'gpt-5.1')).toBe(false);
    expect(supportsProviderToolSearch(provider('openai'), 'gpt-4o')).toBe(false);
    expect(supportsProviderToolSearch(provider('openai', 'http://localhost:11434/v1'), 'gpt-5.5')).toBe(false);
  });

  it('rejects every other provider family', () => {
    expect(supportsProviderToolSearch(provider('google'), 'gemini-3-pro')).toBe(false);
    expect(supportsProviderToolSearch(provider('groq'), 'gpt-5.5')).toBe(false);
    expect(supportsProviderToolSearch(provider('ollama'), 'gpt-5.5')).toBe(false);
  });
});

const deferredApp = (overrides: Partial<ToolAppSpec> = {}): ToolAppSpec => ({
  id: 'app-big',
  name: 'BigCatalog',
  exposure: 'deferred',
  enabled: true,
  sources: [{ kind: 'native-group', tools: ['tool_a'] }],
  toolState: {},
  ...overrides,
});

const selectionApp = (overrides: Partial<SelectionApp> = {}): SelectionApp => ({
  id: 'app-big',
  name: 'BigCatalog',
  exposure: 'deferred',
  order: 0,
  tools: [
    { name: 'tool_a', description: '', enabled: true, keywordTags: [] },
    { name: 'tool_b', description: '', enabled: true, keywordTags: [] },
  ],
  ...overrides,
});

describe('deferred selection semantics', () => {
  it('binds deferred apps unconditionally behind search when capable', () => {
    const result = selectApps({
      apps: [selectionApp()],
      query: 'nothing relevant here',
      totalToolCount: 12,
      nonAppToolCount: 10,
      sticky: { entries: new Map() },
      deferredCapable: true,
    });
    expect(result.decisions[0].reason).toBe('deferred');
    expect(result.keptToolNames).toEqual(['tool_a', 'tool_b']);
    expect(result.deferredToolCount).toBe(2);
    expect(result.hintAppIds).toEqual([]);
  });

  it('excludes deferred-bound tools from the budget (flat context)', () => {
    const tools = (n: number) =>
      Array.from({ length: n }, (_, index) => ({ name: `t${index}`, description: '', enabled: true, keywordTags: [] }));
    const result = selectApps({
      apps: [selectionApp({ tools: tools(40) })],
      query: 'nothing relevant here',
      totalToolCount: 60,
      nonAppToolCount: 20,
      sticky: { entries: new Map() },
      budget: 25,
      deferredCapable: true,
    });
    expect(result.decisions[0].reason).toBe('deferred');
    expect(result.overBudget).toBe(false);
  });

  it('falls back to relevance semantics when the provider is incapable (D3)', () => {
    const result = selectApps({
      apps: [selectionApp()],
      query: 'nothing relevant here',
      totalToolCount: 12,
      nonAppToolCount: 10,
      sticky: { entries: new Map() },
      deferredCapable: false,
    });
    expect(result.decisions[0].reason).toBe('no-match');
    expect(result.keptToolNames).toEqual([]);
    expect(result.deferredToolCount).toBe(0);
    expect(result.hintAppIds).toEqual(['app-big']);
  });

  it('counts fallback-bound deferred tools in the budget', () => {
    const tools = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, index) => ({
        name: `${prefix}${index}`,
        description: 'big catalog item',
        enabled: true,
        keywordTags: [prefix],
      }));
    const result = selectApps({
      apps: [selectionApp({ tools: tools(40, 'big') })],
      query: 'big item0',
      totalToolCount: 60,
      nonAppToolCount: 20,
      sticky: { entries: new Map() },
      budget: 25,
      deferredCapable: false,
    });
    expect(result.decisions[0].reason).toBe('budget-drop');
    expect(result.overBudget).toBe(false);
  });
});

const serverConfig = (): McpServerConfig => ({
  id: 'fx',
  name: 'fixture',
  transport: { type: 'stdio', command: process.execPath, args: [FIXTURE] },
  enabled: true,
  defaultAction: 'allow',
});

class AnthropicScriptedModel extends ScriptedChatModel {
  getName(): string {
    return 'ChatAnthropic';
  }
}

describe('deferred trajectories (fixture MCP app)', () => {
  const provider = (type: LLMProviderType, apiBase?: string) =>
    ({ id: 'p1', type, apiBase, systemPrompt: '' }) as unknown as LLMProvider;

  function makeRunner(providerArg: LLMProvider, apps: ToolAppSpec[], capableModel = false) {
    const manager = new McpManager({
      listServers: () => apps.flatMap((app) => (app.sources[0].kind === 'mcp' ? [app.sources[0].server] : [])),
      toolOverrides: () => undefined,
      readSecrets: async () => ({}),
    });
    const deps: AssistantRunnerDeps = {
      registry: new ToolRegistry(),
      policy: new ToolPolicyEngine(() => ({
        toolGrants: {},
        disabledTools: [],
        grantedRoots: [],
        toolSettings: {},
        classDefaults: {},
      })),
      mcp: manager,
      apps: { listEnabled: async () => apps, budget: async () => 25 },
      createModel: () =>
        capableModel
          ? new AnthropicScriptedModel([new AIMessage({ content: 'ok' })])
          : new ScriptedChatModel([new AIMessage({ content: 'ok' })]),
    };
    return { runner: createAssistantRunner(deps), close: () => manager.close() };
  }

  const fixtureApp = (): ToolAppSpec => ({
    id: 'app-fx',
    name: 'FixtureApp',
    exposure: 'deferred',
    enabled: true,
    sources: [{ kind: 'mcp', server: serverConfig() }],
    toolState: {},
  });

  it('a capable provider defers the app and its tools remain callable by name', async () => {
    const { runner, close } = makeRunner(provider('anthropic'), [fixtureApp()], true);
    try {
      const events = [];
      for await (const event of runner.run({
        provider: provider('anthropic'),
        modelId: 'claude-sonnet-4-5',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'anything' }],
        threadId: 'conv:deferred',
      })) {
        events.push(event);
      }
      const selection = events.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('deferred');
      expect(events.at(-1)).toMatchObject({ type: 'final', text: 'ok' });
    } finally {
      await close();
    }
  });

  it('an incapable provider falls back to relevance — the deferred app is dropped on a miss', async () => {
    const { runner, close } = makeRunner(provider('google'), [fixtureApp()]);
    try {
      const events = [];
      for await (const event of runner.run({
        provider: provider('google'),
        modelId: 'gemini-3-pro',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'anything at all' }],
        threadId: 'conv:fallback',
      })) {
        events.push(event);
      }
      const selection = events.find((event) => event.type === 'app_selection') as
        | { decisions: { reason: string }[] }
        | undefined;
      expect(selection?.decisions[0]?.reason).toBe('no-match');
    } finally {
      await close();
    }
  });
});
