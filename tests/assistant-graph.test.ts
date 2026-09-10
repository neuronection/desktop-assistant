import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { z } from 'zod';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';
import {
  buildSystemPrompt,
  buildInterruptOn,
  createAssistantRunner,
  extractInterruptRequests,
  type AssistantEvent,
} from '@main/ai/graphs/assistant';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import type { LLMProvider } from '@shared/types';

const echoDef: NativeToolDefinition<{ text: string }> = {
  name: 'echo',
  description: 'Echoes text.',
  schema: z.object({ text: z.string() }),
  risk: 'read-only',
  summarize: (args) => `Echo: ${args.text}`,
  exec: async (args) => `Echoed ${args.text}`,
};

const riskyDef: NativeToolDefinition<{ target: string }> = {
  name: 'risky',
  description: 'A state-changing tool.',
  schema: z.object({ target: z.string() }),
  risk: 'state-changing',
  summarize: (args) => `Risk: ${args.target}`,
  exec: async (args) => `Touched ${args.target}`,
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

  private nextMessage(): AIMessage {
    const message = this.script[Math.min(this.step, this.script.length - 1)];
    this.step += 1;
    return message;
  }

  async _generate(
    _messages: BaseMessage[],
    _options: unknown,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const message = this.nextMessage();
    const text = typeof message.content === 'string' ? message.content : '';
    if (text) {
      await runManager?.handleLLMNewToken(text);
    }
    return { generations: [{ text, message }] };
  }
}

async function collect(run: AsyncGenerator<AssistantEvent, void, unknown>): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

describe('createAssistantRunner', () => {
  const auditRecords: AiCallRecord[] = [];
  afterEach(() => {
    setAuditSink(async () => undefined);
    auditRecords.length = 0;
  });

  it('runs a tool-calling trajectory end to end and audits every LLM call', async () => {
    setAuditSink(async (record) => {
      auditRecords.push(record);
    });
    const registry = new ToolRegistry();
    registry.register(echoDef);
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'echo', args: { text: 'hi' } }] }),
      new AIMessage({ content: 'All done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model });
    await expect(runner.getToolCount()).resolves.toBe(1);

    const events = await collect(
      runner.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'say hi via echo' }],
        threadId: 'conv_1:turn_1',
      })
    );

    const types = events.map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(['tool_calls', 'tool_results', 'delta', 'final']));

    const toolCalls = events.find((event) => event.type === 'tool_calls') as Extract<AssistantEvent, { type: 'tool_calls' }>;
    expect(toolCalls.calls).toEqual([
      { id: 'call_1', name: 'echo', args: { text: 'hi' }, summary: 'Echo: hi', risk: 'read-only' },
    ]);

    const toolResults = events.filter((event) => event.type === 'tool_results') as Extract<
      AssistantEvent,
      { type: 'tool_results' }
    >[];
    const flattened = toolResults.flatMap((event) => event.results);
    expect(flattened).toEqual([{ id: 'call_1', summary: 'Echoed hi', isError: false, content: 'Echoed hi' }]);

    const final = events.at(-1) as Extract<AssistantEvent, { type: 'final' }>;
    expect(final.text).toBe('All done.');
    expect(events.some((event) => event.type === 'delta')).toBe(true);

    await vi.waitFor(() => {
      expect(auditRecords).toHaveLength(2);
    });
    expect(auditRecords.every((record) => record.task === 'chat.agent' && record.outcome === 'ok')).toBe(true);
  });

  it('handles parallel tool calls in one model turn', async () => {
    const registry = new ToolRegistry();
    registry.register(echoDef);
    const model = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call_a', name: 'echo', args: { text: 'one' } },
          { id: 'call_b', name: 'echo', args: { text: 'two' } },
        ],
      }),
      new AIMessage({ content: 'Both done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model });
    const events = await collect(
      runner.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [],
        threadId: 'conv_1:turn_2',
      })
    );

    const toolCalls = events.find((event) => event.type === 'tool_calls') as Extract<AssistantEvent, { type: 'tool_calls' }>;
    expect(toolCalls.calls.map((call) => call.id)).toEqual(['call_a', 'call_b']);

    const results = events
      .filter((event) => event.type === 'tool_results')
      .flatMap((event) => (event as Extract<AssistantEvent, { type: 'tool_results' }>).results);
    expect(results.map((result) => result.id).sort()).toEqual(['call_a', 'call_b']);
  });

  it('surfaces model failures as thrown errors and audits the error outcome', async () => {
    const records: AiCallRecord[] = [];
    setAuditSink(async (record) => {
      records.push(record);
    });
    const registry = new ToolRegistry();
    registry.register(echoDef);
    const model = new ScriptedChatModel([new AIMessage({ content: 'ok' })]);
    model._generate = async () => {
      throw new Error('provider down');
    };

    const runner = createAssistantRunner({ registry, createModel: () => model });
    await expect(
      collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [],
          threadId: 'conv_1:turn_3',
        })
      )
    ).rejects.toThrow('provider down');

    await vi.waitFor(() => {
      expect(records.some((record) => record.outcome === 'error')).toBe(true);
    });
  });
});

describe('buildSystemPrompt', () => {
  it('composes guidance, tool names, and the provider prompt', () => {
    const prompt = buildSystemPrompt('  Be terse.  ', ['screen_capture', 'web_fetch']);
    expect(prompt).toContain('Available tools: screen_capture, web_fetch');
    expect(prompt).toContain('untrusted observations');
    expect(prompt).toContain('Additional instructions from the user:');
    expect(prompt).toContain('Be terse.');

    const noTools = buildSystemPrompt('', []);
    expect(noTools).toContain('No tools are available');
    expect(noTools).not.toContain('Additional instructions');
  });

  it('adds memory guidance only when memory tools are bound', () => {
    const withMemory = buildSystemPrompt('', ['memory_save', 'memory_list']);
    expect(withMemory).toContain('persistent memory');
    expect(withMemory).toContain('[Memory context]');

    const withoutMemory = buildSystemPrompt('', ['screen_capture']);
    expect(withoutMemory).not.toContain('persistent memory');
  });

  it('embeds the recallable-screenshot index when provided', () => {
    const prompt = buildSystemPrompt('', ['recall_screenshot'], [
      'screen_capture — tool_call_1 — 14:32',
      'screen_capture — tool_call_2 — 14:40',
    ]);
    expect(prompt).toContain('recall_screenshot');
    expect(prompt).toContain('- screen_capture — tool_call_1 — 14:32');
    expect(prompt).toContain('- screen_capture — tool_call_2 — 14:40');

    expect(buildSystemPrompt('', ['recall_screenshot'])).not.toContain('Previously captured screenshots');
  });

  it('toolFilter keeps unbound tools from the agent and the prompt', async () => {
    const registry = new ToolRegistry();
    registry.register(echoDef);
    registry.register(riskyDef);
    const runner = createAssistantRunner({
      registry,
      createModel: () => new ScriptedChatModel([new AIMessage({ content: 'ok' })]),
      toolFilter: (name) => name !== 'risky',
    });
    expect(await runner.getToolCount()).toBe(1);

    const events = await collect(runner.run({
      provider,
      modelId: 'test-model',
      apiKey: 'sk-test',
      history: [{ role: 'user', content: 'hi' }],
      threadId: 'conv_filter:turn_1',
    }));
    const final = events.at(-1);
    expect(final?.type).toBe('final');
  });
});

function makePolicy(overrides: { disabled?: string[]; grants?: string[] } = {}): ToolPolicyEngine {
  const engine = new ToolPolicyEngine(() => ({
    toolGrants: {},
    disabledTools: overrides.disabled ?? [],
    grantedRoots: [],
  }));
  for (const name of overrides.grants ?? []) {
    engine.grantSession(name);
  }
  return engine;
}

describe('approval flow (HITL middleware)', () => {
  afterEach(() => {
    setAuditSink(async () => undefined);
  });

  it('interrupts a state-changing tool call and executes it after resume', async () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    registry.register(echoDef);
    const engine = makePolicy();
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'risky', args: { target: '/tmp/x' } }] }),
      new AIMessage({ content: 'Done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine });
    const threadId = 'conv_9:turn_1';
    const first = await collect(
      runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [{ role: 'user', content: 'go' }], threadId })
    );

    const interrupts = first.filter((event): event is Extract<AssistantEvent, { type: 'interrupt' }> => event.type === 'interrupt');
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0].requests).toEqual([
      {
        id: 'appr_0',
        toolName: 'risky',
        args: { target: '/tmp/x' },
        summary: 'Risk: /tmp/x',
        risk: 'state-changing',
        allowedDecisions: ['approve', 'reject'],
      },
    ]);
    expect(first.some((event) => event.type === 'tool_results')).toBe(false);
    expect(first.some((event) => event.type === 'final')).toBe(false);

    const second = await collect(
      runner.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'go' }],
        threadId,
        resume: [{ type: 'approve' }],
      })
    );

    const results = second
      .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
      .flatMap((event) => event.results);
    expect(results).toEqual([{ id: 'call_1', summary: 'Touched /tmp/x', isError: false, content: 'Touched /tmp/x' }]);
    const final = second.at(-1) as Extract<AssistantEvent, { type: 'final' }>;
    expect(final.text).toBe('Done.');
  });

  it('auto-runs granted tools without interrupting', async () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const engine = makePolicy({ grants: ['risky'] });
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'risky', args: { target: '/tmp/y' } }] }),
      new AIMessage({ content: 'All done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine });
    const events = await collect(
      runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [], threadId: 'conv_9:turn_2' })
    );

    expect(events.some((event) => event.type === 'interrupt')).toBe(false);
    const results = events
      .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
      .flatMap((event) => event.results);
    expect(results.map((result) => result.summary)).toEqual(['Touched /tmp/y']);
  });

  it('rejects with a tool error message the model can see', async () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const engine = makePolicy();
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'risky', args: { target: '/nope' } }] }),
      new AIMessage({ content: 'Understood, nothing was touched.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine });
    const threadId = 'conv_9:turn_3';
    await collect(
      runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [], threadId })
    );
    const second = await collect(
      runner.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [],
        threadId,
        resume: [{ type: 'reject', message: 'Denied by the user.' }],
      })
    );
    const results = second
      .filter((event): event is Extract<AssistantEvent, { type: 'tool_results' }> => event.type === 'tool_results')
      .flatMap((event) => event.results);
    expect(results[0]).toMatchObject({ id: 'call_1', isError: true });
    expect(second.at(-1)).toMatchObject({ type: 'final', text: 'Understood, nothing was touched.' });
  });

  it('omits disabled tools from the interrupt config', () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    registry.register(echoDef);
    const engine = makePolicy({ disabled: ['risky'] });
    const interruptOn = buildInterruptOn(registry, engine);
    expect(interruptOn).not.toHaveProperty('risky');
    expect(interruptOn).toEqual({});
  });
});

describe('extractInterruptRequests', () => {
  it('maps the raw langgraph interrupt payload onto approval requests', () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const requests = extractInterruptRequests(
      {
        __interrupt__: [
          {
            value: {
              actionRequests: [{ name: 'risky', args: { target: '/tmp' }, description: 'desc' }],
              reviewConfigs: [{ actionName: 'risky', allowedDecisions: ['approve', 'reject'] }],
            },
          },
        ],
      },
      registry
    );
    expect(requests).toEqual([
      {
        id: 'appr_0',
        toolName: 'risky',
        args: { target: '/tmp' },
        summary: 'Risk: /tmp',
        risk: 'state-changing',
        allowedDecisions: ['approve', 'reject'],
      },
    ]);
  });

  it('returns nothing when the chunk has no interrupt', () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    expect(extractInterruptRequests({ model: { messages: [] } }, registry)).toEqual([]);
  });
});

class StreamingChatModel extends BaseChatModel {
  lc_serializable = false;

  constructor(private readonly tokens: string[]) {
    super({});
  }

  _modelType(): string {
    return 'streaming_chat_model';
  }

  _llmType(): string {
    return 'streaming_chat_model';
  }

  bindTools(): this {
    return this;
  }

  async _generate(
    _messages: BaseMessage[],
    _options: unknown,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    for (const token of this.tokens) {
      await runManager?.handleLLMNewToken(token);
    }
    const full = this.tokens.join('');
    const message = new AIMessage({ content: full });
    return { generations: [{ text: full, message }] };
  }
}

describe('assistant delta streaming', () => {
  it('preserves whitespace in delta chunks so streamed markdown keeps its formatting', async () => {
    const registry = new ToolRegistry();
    const model = new StreamingChatModel(['### ', 'The ', 'Lantern', '\n\n', 'The ', 'end', '.']);

    const runner = createAssistantRunner({ registry, createModel: () => model });
    const events = await collect(
      runner.run({
        provider,
        modelId: 'test-model',
        apiKey: 'sk-test',
        history: [{ role: 'user', content: 'tell a story' }],
        threadId: 'conv_1:turn_2',
      })
    );

    const deltas = events
      .filter((event): event is Extract<AssistantEvent, { type: 'delta'; text: string }> => event.type === 'delta')
      .map((event) => event.text);
    expect(deltas.join('')).toBe('### The Lantern\n\nThe end.');

    const final = events.at(-1) as Extract<AssistantEvent, { type: 'final'; text: string }>;
    expect(final.text).toBe('### The Lantern\n\nThe end.');
  });
});

describe('filesystem access requests (HITL)', () => {
  const readerDef: NativeToolDefinition<{ path: string }> = {
    name: 'reader',
    description: 'Reads a confined path.',
    schema: z.object({ path: z.string() }),
    risk: 'read-only',
    pathArgs: ['path'],
    summarize: (args) => `Read ${args.path}`,
    exec: async (args, ctx) => `roots=[${(ctx.grantedRoots ?? []).join('|')}]`,
  };

  function makePolicyWithRoots(roots: string[]): ToolPolicyEngine {
    return new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: roots,
      toolSettings: {},
      classDefaults: {},
    }));
  }

  it('includes confined read-only tools in the interrupt config only for access requests', () => {
    const registry = new ToolRegistry();
    registry.register(readerDef);
    registry.register(echoDef);
    const engine = makePolicyWithRoots([]);
    const config = buildInterruptOn(registry, engine);

    expect(config.reader).toBeDefined();
    expect(config.echo).toBeUndefined();

    const inside = config.reader.when!({ toolCall: { name: 'reader', args: { path: '/g/file.txt' } } });
    expect(inside).toBe(false);

    const outside = config.reader.when!({ toolCall: { name: 'reader', args: { path: '/etc/hosts' } } });
    expect(outside).toBe(true);
  });

  it('augments interrupt summaries with the requested folders', () => {
    const registry = new ToolRegistry();
    registry.register(readerDef);
    const engine = makePolicyWithRoots([]);
    const payload = {
      __interrupt__: [
        {
          value: {
            actionRequests: [{ name: 'reader', args: { path: join(tmpdir(), 'x', 'y.txt') } }],
            reviewConfigs: [],
          },
        },
      ],
    };
    const requests = extractInterruptRequests(payload, registry, engine);
    expect(requests[0].summary).toContain('needs access to');
  });

  it('runs the full loop: interrupt → approve → retry sees the granted root', async () => {
    const grantDir = mkdtempSync(join(tmpdir(), 'da-access-'));
    try {
      const outsidePath = join(grantDir, 'notes.md');
      const registry = new ToolRegistry();
      registry.register(readerDef);
      const engine = makePolicyWithRoots([]);
      const model = new ScriptedChatModel([
        new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'reader', args: { path: outsidePath } }] }),
        new AIMessage({ content: 'Done.' }),
      ]);
      const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine });
      const threadId = 'conv_access:turn_1';

      const first = await collect(
        runner.run({ provider, modelId: 'test-model', apiKey: 'sk-test', history: [{ role: 'user', content: 'read it' }], threadId })
      );
      const interrupt = first.find((event) => event.type === 'interrupt');
      expect(interrupt).toBeDefined();
      expect(interrupt?.requests[0].summary).toContain('needs access to');

      engine.grantRootSession(grantDir);

      const second = await collect(
        runner.run({
          provider,
          modelId: 'test-model',
          apiKey: 'sk-test',
          history: [{ role: 'user', content: 'read it' }],
          threadId,
          resume: [{ type: 'approve' }],
        })
      );
      const results = second.find((event) => event.type === 'tool_results');
      expect(results?.results[0].summary).toContain(`roots=[${resolve(grantDir)}]`);
      const final = second.at(-1);
      expect(final?.type).toBe('final');
    } finally {
      rmSync(grantDir, { recursive: true, force: true });
    }
  });
});
