import { describe, it, expect, afterEach } from 'vitest';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { ChatResult } from '@langchain/core/outputs';
import { z } from 'zod';
import {
  createAssistantRunner,
  nodeLabel,
  type AssistantEvent,
} from '@main/ai/graphs/assistant';
import { ToolRegistry } from '@main/ai/tools/registry';
import { ToolPolicyEngine } from '@main/ai/tools/policy';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import { setAuditSink } from '@main/ai/audit';
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

type NodeEvent = Extract<AssistantEvent, { type: 'node_started' }> | Extract<AssistantEvent, { type: 'node_finished' }>;

function nodeEvents(events: AssistantEvent[]): NodeEvent[] {
  return events.filter(
    (event): event is NodeEvent => event.type === 'node_started' || event.type === 'node_finished'
  );
}

function nodeTuples(events: AssistantEvent[]): [string, string][] {
  return nodeEvents(events).map((event) => [event.type, event.node]);
}

async function collect(
  run: AsyncGenerator<AssistantEvent, void, unknown>,
  sink?: AssistantEvent[]
): Promise<AssistantEvent[]> {
  const events: AssistantEvent[] = sink ?? [];
  for await (const event of run) {
    events.push(event);
  }
  return events;
}

function makeTurn(overrides: Partial<Parameters<ReturnType<typeof createAssistantRunner>['run']>[0]> = {}) {
  return {
    provider,
    modelId: 'test-model',
    apiKey: 'sk-test',
    history: [{ role: 'user', content: 'hi' }] as { role: string; content: unknown }[],
    threadId: 'conv_nodes:turn_1',
    ...overrides,
  };
}

describe('node telemetry (plan 13 S1)', () => {
  afterEach(() => {
    setAuditSink(async () => undefined);
  });

  it('emits model → tools → model node lifecycle around a tool hop', async () => {
    const registry = new ToolRegistry();
    registry.register(echoDef);
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'echo', args: { text: 'hi' } }] }),
      new AIMessage({ content: 'All done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model });
    const events = await collect(runner.run(makeTurn()));

    expect(nodeTuples(events)).toEqual([
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
      ['node_started', 'tools'],
      ['node_finished', 'tools'],
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
    ]);

    for (const event of nodeEvents(events)) {
      expect(event.resumed).toBe(false);
      if (event.type === 'node_finished') {
        expect(event.durationMs).toBeGreaterThanOrEqual(0);
        expect(event.outcome).toBe('done');
      }
    }
    expect(nodeEvents(events)[0]).toMatchObject({ node: 'model_request', label: 'Thinking' });
    expect(nodeEvents(events)[2]).toMatchObject({ node: 'tools', label: 'Using tools' });

    const deltas = events
      .filter((event): event is Extract<AssistantEvent, { type: 'delta' }> => event.type === 'delta')
      .map((event) => event.text);
    expect(deltas.join('')).toBe('All done.');
    const final = events.at(-1) as Extract<AssistantEvent, { type: 'final' }>;
    expect(final.text).toBe('All done.');
  });

  it('produces a node pair per hop across multiple tool rounds', async () => {
    const registry = new ToolRegistry();
    registry.register(echoDef);
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'echo', args: { text: 'one' } }] }),
      new AIMessage({ content: '', tool_calls: [{ id: 'call_2', name: 'echo', args: { text: 'two' } }] }),
      new AIMessage({ content: 'Finished both.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model });
    const events = await collect(runner.run(makeTurn({ threadId: 'conv_nodes:turn_2' })));

    expect(nodeTuples(events)).toEqual([
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
      ['node_started', 'tools'],
      ['node_finished', 'tools'],
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
      ['node_started', 'tools'],
      ['node_finished', 'tools'],
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
    ]);
  });

  it('closes the node as interrupted and marks the replayed node resumed after approval', async () => {
    const registry = new ToolRegistry();
    registry.register(riskyDef);
    const engine = new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
    }));
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'risky', args: { target: '/tmp/x' } }] }),
      new AIMessage({ content: 'Done.' }),
    ]);

    const runner = createAssistantRunner({ registry, createModel: () => model, policy: engine });
    const threadId = 'conv_nodes:turn_3';
    const first = await collect(runner.run(makeTurn({ threadId })));

    expect(nodeTuples(first)).toEqual([
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
    ]);
    const interruptedClose = nodeEvents(first)[1];
    expect(interruptedClose.type === 'node_finished' && interruptedClose.outcome).toBe('interrupted');
    expect(interruptedClose.type === 'node_finished' && interruptedClose.resumed).toBe(false);

    const second = await collect(
      runner.run(makeTurn({ threadId, resume: [{ type: 'approve' }] }))
    );
    expect(nodeTuples(second)).toEqual([
      ['node_started', 'HumanInTheLoopMiddleware.after_model'],
      ['node_finished', 'HumanInTheLoopMiddleware.after_model'],
      ['node_started', 'tools'],
      ['node_finished', 'tools'],
      ['node_started', 'model_request'],
      ['node_finished', 'model_request'],
      ['node_started', 'HumanInTheLoopMiddleware.after_model'],
      ['node_finished', 'HumanInTheLoopMiddleware.after_model'],
    ]);

    const timeline = nodeEvents(second);
    const replayedClose = timeline[1];
    expect(replayedClose.type === 'node_finished' && replayedClose.resumed).toBe(true);
    expect(
      replayedClose.type === 'node_finished' && replayedClose.label === replayedClose.node
    ).toBe(true);
    const afterReplay = timeline.slice(2);
    expect(afterReplay.every((event) => event.resumed === false)).toBe(true);
    expect(second.at(-1)).toMatchObject({ type: 'final', text: 'Done.' });
  });

  it('closes the open node as failed when the model errors mid-node', async () => {
    const registry = new ToolRegistry();
    const model = new ScriptedChatModel([new AIMessage({ content: 'ok' })]);
    model._generate = async (_messages, _options, runManager) => {
      await runManager?.handleLLMNewToken('partial');
      throw new Error('stream blew up');
    };

    const runner = createAssistantRunner({ registry, createModel: () => model });
    const events: AssistantEvent[] = [];
    await expect(
      (async () => {
        for await (const event of runner.run(makeTurn())) {
          events.push(event);
        }
      })()
    ).rejects.toThrow('stream blew up');

    expect(nodeEvents(events)).toEqual([
      { type: 'node_started', node: 'model_request', label: 'Thinking', resumed: false },
      {
        type: 'node_finished',
        node: 'model_request',
        label: 'Thinking',
        outcome: 'failed',
        durationMs: expect.any(Number),
        resumed: false,
      },
    ]);
  });

  it('falls back to the raw node name for unknown nodes', () => {
    expect(nodeLabel('model_request')).toBe('Thinking');
    expect(nodeLabel('tools')).toBe('Using tools');
    expect(nodeLabel('future_middleware_node')).toBe('future_middleware_node');
  });
});
