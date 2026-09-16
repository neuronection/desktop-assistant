import { describe, it, expect, afterEach, vi } from 'vitest';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';
import { z } from 'zod';
import {
  createResearchRunner,
  researchNodeLabel,
  RESEARCH_CANCELLED_TEXT,
  MAX_RESEARCH_ROUNDS,
  RESEARCH_RECURSION_LIMIT,
  type ResearchRunnerDeps,
} from '@main/ai/graphs/research';
import type { AssistantEvent } from '@main/ai/graphs/assistant';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { TEXT } from '@shared/constants/text';
import type { LLMProvider } from '@shared/types';

const webSearchDef: NativeToolDefinition<{ query: string }> = {
  name: 'web_search',
  description: 'Searches the web (fake).',
  schema: z.object({ query: z.string() }),
  risk: 'read-only',
  category: 'network',
  summarize: (args) => `Searched the web for “${args.query}”`,
  exec: async (args) =>
    [
      'Web results via fake:',
      '1. [Result A](https://example.com/a) — snippet A',
      '2. [Result B](https://example.com/b) — snippet B',
      `(${args.query})`,
    ].join('\n'),
};

const wideSearchDef: NativeToolDefinition<{ query: string }> = {
  ...webSearchDef,
  exec: async (args) => {
    const tag = encodeURIComponent(args.query).replace(/%/g, '').slice(0, 12) || 'q';
    return [
      'Web results via fake:',
      ...[1, 2, 3, 4, 5].map((n) => `${n}. [R${n}](https://example.com/${n}/${tag}) — s${n}`),
    ].join('\n');
  },
};

const webFetchDef: NativeToolDefinition<{ url: string }> = {
  name: 'web_fetch',
  description: 'Fetches a page (fake).',
  schema: z.object({ url: z.string() }),
  risk: 'read-only',
  category: 'network',
  summarize: (args) => `Fetched ${args.url}`,
  exec: async (args) => `Content of ${args.url}:\n\nPage text for ${args.url}`,
};

const provider = {
  id: 'p1',
  systemPrompt: 'Be brief.',
} as unknown as LLMProvider;

class ScriptedChatModel extends BaseChatModel {
  lc_serializable = false;

  private step = 0;

  constructor(private readonly script: AIMessage[]) {
    super({});
  }

  _modelType(): string {
    return 'scripted_chat_model';
  }

  _llmType(): string {
    return 'scripted_chat_model';
  }

  _identifyingParams(): Record<string, unknown> {
    return {};
  }

  bindTools(): this {
    return this;
  }

  async _generate(
    _messages: BaseMessage[],
    _options: unknown,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const message = this.script[Math.min(this.step, this.script.length - 1)];
    this.step += 1;
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) {
      await runManager?.handleLLMNewToken(text);
    }
    return { generations: [{ text, message }] };
  }
}

/** Scripted model that throws on the Nth invocation (0-based) — salvage-failure tests. */
class ScriptedFailingChatModel extends ScriptedChatModel {
  private calls = 0;

  constructor(
    script: AIMessage[],
    private readonly failOnCall: number,
    private readonly failure: Error
  ) {
    super(script);
  }

  async _generate(
    messages: BaseMessage[],
    options: unknown,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    if (this.calls++ === this.failOnCall) {
      throw this.failure;
    }
    return super._generate(messages, options, runManager);
  }
}

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

function makeTurn(overrides: Partial<Parameters<ReturnType<typeof createResearchRunner>['run']>[0]> = {}) {
  return {
    provider,
    modelId: 'test-model',
    apiKey: 'sk-test',
    history: [{ role: 'user', content: 'research the topic' }] as { role: string; content: unknown }[],
    threadId: 'conv_research:turn_1',
    ...overrides,
  };
}

type NodeEvent = Extract<AssistantEvent, { type: 'node_started' }> | Extract<AssistantEvent, { type: 'node_finished' }>;

function nodeTuples(events: AssistantEvent[]): [string, string][] {
  return events
    .filter((event): event is NodeEvent => event.type === 'node_started' || event.type === 'node_finished')
    .map((event) => [event.type, event.node]);
}

function allCalls(events: AssistantEvent[]) {
  return toolCallEvents(events).flatMap((event) => event.calls);
}

function toolCallEvents(events: AssistantEvent[]) {
  return events.filter((event): event is Extract<AssistantEvent, { type: 'tool_calls' }> => event.type === 'tool_calls');
}

function toolResults(events: AssistantEvent[]) {
  return events
    .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
    .flatMap((event) => event.results);
}

function makePolicy(overrides: { alwaysAsk?: string[] } = {}): ToolPolicyEngine {
  return new ToolPolicyEngine(() => ({
    toolGrants: {},
    disabledTools: [],
    grantedRoots: [],
    toolSettings: Object.fromEntries(
      (overrides.alwaysAsk ?? []).map((name) => [name, { mode: 'always_ask' as const }])
    ),
    classDefaults: {},
  }));
}

function baseDeps(overrides: Partial<ResearchRunnerDeps> = {}): ResearchRunnerDeps {
  const registry = new ToolRegistry();
  registry.register(webSearchDef);
  registry.register(webFetchDef);
  return { registry, policy: makePolicy(), ...overrides };
}

describe('research flow graph (plan 13 S6)', () => {
  afterEach(() => {
    setAuditSink(async () => undefined);
  });

  it('walks plan → search → fetch → assess → synthesize with per-source references and audits every model call', async () => {
    const auditRecords: AiCallRecord[] = [];
    setAuditSink(async (record) => {
      auditRecords.push(record);
    });
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'langgraph release notes' }),
      new AIMessage({ content: 'DONE' }),
      new AIMessage({ content: 'Report. Sources: [1] example.com/a, [2] example.com/b.' }),
    ]);
    const runner = createResearchRunner(baseDeps({ createModel: () => model }));
    await expect(runner.getToolCount()).resolves.toBe(2);

    const events = await collect(runner.run(makeTurn()));

    expect(nodeTuples(events)).toEqual([
      ['node_started', 'plan'],
      ['node_finished', 'plan'],
      ['node_started', 'search'],
      ['node_finished', 'search'],
      ['node_started', 'fetch'],
      ['node_finished', 'fetch'],
      ['node_started', 'assess'],
      ['node_finished', 'assess'],
      ['node_started', 'synthesize'],
      ['node_finished', 'synthesize'],
    ]);

    const calls = allCalls(events);
    expect(calls.map((call) => call.name)).toEqual(['web_search', 'web_fetch', 'web_fetch']);
    expect(calls[0].args).toEqual({ query: 'langgraph release notes' });
    expect(calls[1].args).toEqual({ url: 'https://example.com/a' });
    expect(calls[2].args).toEqual({ url: 'https://example.com/b' });

    const results = toolResults(events);
    expect(results).toHaveLength(3);
    expect(results.every((result) => !result.isError)).toBe(true);

    const final = events.at(-1) as Extract<AssistantEvent, { type: 'final' }>;
    expect(final.text).toContain('[1]');
    expect(final.text).toContain('example.com/a');

    await vi.waitFor(() => {
      expect(auditRecords).toHaveLength(3);
    });
    expect(auditRecords.every((record) => record.task === 'chat.research' && record.outcome === 'ok')).toBe(true);
  });

  it('caps fetches at two per round and bounds the loop at three rounds', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'query one' }),
      new AIMessage({ content: 'MORE\nquery two' }),
      new AIMessage({ content: 'MORE\nquery three' }),
      new AIMessage({ content: 'MORE\nquery four' }),
      new AIMessage({ content: 'Final report.' }),
    ]);
    const registry = new ToolRegistry();
    registry.register(wideSearchDef);
    registry.register(webFetchDef);
    const runner = createResearchRunner(baseDeps({ registry, createModel: () => model }));

    const events = await collect(runner.run(makeTurn({ threadId: 'conv_research:turn_caps' })));

    const calls = allCalls(events);
    expect(calls.filter((call) => call.name === 'web_search')).toHaveLength(3);
    const fetchCalls = calls.filter((call) => call.name === 'web_fetch');
    expect(fetchCalls).toHaveLength(3 * 2);

    const searchStarted = nodeTuples(events).filter(([type, node]) => type === 'node_started' && node === 'search');
    expect(searchStarted).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'final', text: 'Final report.' });
  });

  it('interrupts on a policy-gated fetch and ends cleanly when the user denies', async () => {
    const policy = makePolicy({ alwaysAsk: ['web_fetch'] });
    const model = new ScriptedChatModel([new AIMessage({ content: 'query one' })]);
    const runner = createResearchRunner(baseDeps({ policy, createModel: () => model }));
    const threadId = 'conv_research:turn_deny';

    const first = await collect(runner.run(makeTurn({ threadId })));

    const interrupts = first.filter(
      (event): event is Extract<AssistantEvent, { type: 'interrupt' }> => event.type === 'interrupt'
    );
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0].requests.map((request) => request.toolName)).toEqual(['web_fetch', 'web_fetch']);
    expect(interrupts[0].requests[0]).toMatchObject({
      id: 'appr_0',
      args: { url: 'https://example.com/a' },
      summary: 'Fetched https://example.com/a',
      risk: 'read-only',
      allowedDecisions: ['approve', 'reject'],
    });
    expect(first.some((event) => event.type === 'final')).toBe(false);
    expect(nodeTuples(first)).toContainEqual(['node_finished', 'fetch']);

    const second = await collect(
      runner.run(makeTurn({ threadId, resume: [{ type: 'reject', message: 'Denied by the user.' }] }))
    );

    expect(toolResults(second).filter((result) => result.id.startsWith('fetch_'))).toHaveLength(0);
    expect(nodeTuples(second)[0]).toEqual(['node_started', 'fetch']);
    expect(nodeTuples(second)).toContainEqual(['node_finished', 'fetch']);
    const final = second.at(-1) as Extract<AssistantEvent, { type: 'final' }>;
    expect(final.text).toBe(RESEARCH_CANCELLED_TEXT);
  });

  it('completes the flow after an approval resumes on the same thread', async () => {
    const policy = makePolicy({ alwaysAsk: ['web_fetch'] });
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'query one' }),
      new AIMessage({ content: 'DONE' }),
      new AIMessage({ content: 'Approved research report.' }),
    ]);
    const runner = createResearchRunner(baseDeps({ policy, createModel: () => model }));
    const threadId = 'conv_research:turn_approve';

    const first = await collect(runner.run(makeTurn({ threadId })));
    expect(first.some((event) => event.type === 'interrupt')).toBe(true);

    const second = await collect(runner.run(makeTurn({ threadId, resume: [{ type: 'approve' }] })));
    const fetchResults = toolResults(second).filter((result) => result.id.startsWith('fetch_'));
    expect(fetchResults).toHaveLength(2);
    expect(second.at(-1)).toMatchObject({ type: 'final', text: 'Approved research report.' });
    expect(nodeTuples(second)[0]).toEqual(['node_started', 'fetch']);
  });

  it('derives a recursion budget that fits a full run plus approval replays', () => {
    expect(RESEARCH_RECURSION_LIMIT).toBeGreaterThanOrEqual(3 * MAX_RESEARCH_ROUNDS + 3);
  });

  it('completes a full three-round run with per-round fetch approvals inside the derived budget', async () => {
    const policy = makePolicy({ alwaysAsk: ['web_fetch'] });
    const registry = new ToolRegistry();
    registry.register(wideSearchDef);
    registry.register(webFetchDef);
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'query one' }),
      new AIMessage({ content: 'MORE\nquery two' }),
      new AIMessage({ content: 'MORE\nquery three' }),
      new AIMessage({ content: 'DONE' }),
      new AIMessage({ content: 'Full three-round report.' }),
    ]);
    const runner = createResearchRunner(baseDeps({ registry, policy, createModel: () => model }));
    const threadId = 'conv_research:turn_full_run_approvals';

    const all: AssistantEvent[] = [];
    let events = await collect(runner.run(makeTurn({ threadId })));
    all.push(...events);
    let resumes = 0;
    while (!events.some((event) => event.type === 'final')) {
      expect(events.some((event) => event.type === 'interrupt')).toBe(true);
      resumes += 1;
      expect(resumes).toBeLessThanOrEqual(MAX_RESEARCH_ROUNDS);
      events = await collect(runner.run(makeTurn({ threadId, resume: [{ type: 'approve' }] })));
      all.push(...events);
    }

    expect(resumes).toBe(MAX_RESEARCH_ROUNDS);
    const searchStarts = nodeTuples(all).filter(([type, node]) => type === 'node_started' && node === 'search');
    expect(searchStarts).toHaveLength(MAX_RESEARCH_ROUNDS);
    expect(allCalls(all).filter((call) => call.name === 'web_fetch')).toHaveLength(MAX_RESEARCH_ROUNDS * 2);
    expect(events.at(-1)).toMatchObject({ type: 'final', text: 'Full three-round report.' });
  });

  it('interrupts the search node too when policy asks (no policy bypass in nodes)', async () => {
    const policy = makePolicy({ alwaysAsk: ['web_search'] });
    const model = new ScriptedChatModel([new AIMessage({ content: 'query one' })]);
    const runner = createResearchRunner(baseDeps({ policy, createModel: () => model }));

    const events = await collect(runner.run(makeTurn({ threadId: 'conv_research:turn_search_ask' })));

    const interrupts = events.filter(
      (event): event is Extract<AssistantEvent, { type: 'interrupt' }> => event.type === 'interrupt'
    );
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0].requests[0].toolName).toBe('web_search');
    expect(events.some((event) => event.type === 'tool_results')).toBe(false);
  });

  it('salvages findings when the recursion budget is exceeded mid-flow', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'query' }),
      new AIMessage({ content: 'Salvaged findings report.' }),
    ]);
    const runner = createResearchRunner(baseDeps({ createModel: () => model, recursionLimit: 3 }));

    const events: AssistantEvent[] = [];
    for await (const event of runner.run(makeTurn({ threadId: 'conv_research:turn_budget' }))) {
      events.push(event);
    }

    expect(nodeTuples(events)).toEqual([
      ['node_started', 'plan'],
      ['node_finished', 'plan'],
      ['node_started', 'search'],
      ['node_finished', 'search'],
      ['node_started', 'fetch'],
      ['node_finished', 'fetch'],
    ]);
    const failedClose = events
      .filter((event): event is Extract<AssistantEvent, { type: 'node_finished' }> => event.type === 'node_finished')
      .at(-1);
    expect(failedClose?.outcome).toBe('failed');
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      text: 'Salvaged findings report.',
      limitNotice: 'step-budget',
    });
  });

  it('emits the static limit line when the salvage call fails', async () => {
    const model = new ScriptedFailingChatModel([new AIMessage({ content: 'query' })], 1, new Error('salvage down'));
    const runner = createResearchRunner(baseDeps({ createModel: () => model, recursionLimit: 3 }));

    const events: AssistantEvent[] = [];
    for await (const event of runner.run(makeTurn({ threadId: 'conv_research:turn_salvage_fails' }))) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: 'final',
      text: TEXT.TURN_LIMIT_STEP,
      limitNotice: 'step-budget',
    });
  });

  it('labels research nodes and falls back to the raw name', () => {
    expect(researchNodeLabel('plan')).toBe('Planning');
    expect(researchNodeLabel('search')).toBe('Searching the web');
    expect(researchNodeLabel('fetch')).toBe('Reading sources');
    expect(researchNodeLabel('assess')).toBe('Assessing findings');
    expect(researchNodeLabel('synthesize')).toBe('Synthesizing report');
    expect(researchNodeLabel('future_node')).toBe('future_node');
  });

  it('carries the labels on the emitted node events', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: 'query one' }),
      new AIMessage({ content: 'DONE' }),
      new AIMessage({ content: 'Report.' }),
    ]);
    const runner = createResearchRunner(baseDeps({ createModel: () => model }));

    const events = await collect(runner.run(makeTurn({ threadId: 'conv_research:turn_labels' })));

    const started = events.filter(
      (event): event is Extract<AssistantEvent, { type: 'node_started' }> => event.type === 'node_started'
    );
    expect(started.map((event) => [event.node, event.label])).toEqual([
      ['plan', 'Planning'],
      ['search', 'Searching the web'],
      ['fetch', 'Reading sources'],
      ['assess', 'Assessing findings'],
      ['synthesize', 'Synthesizing report'],
    ]);
  });
});
