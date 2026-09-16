import { describe, it, expect, vi } from 'vitest';
import { TurnManager, type TurnManagerDeps } from '@main/turns/TurnManager';
import type { AssistantRunner, AssistantEvent } from '@main/ai/graphs/assistant';
import { setToolCallAuditSink } from '@main/ai/audit';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type { LLMProvider } from '@shared/types';
import type { TurnEvent, TurnMetadata } from '@shared/turns';

const provider = {
  id: 'p1',
  systemPrompt: '',
  availableModels: [
    { id: 'test-model', name: 'Test Model', providerType: 'openai', providerId: 'p1' },
  ],
} as unknown as LLMProvider;

function flowRunner(events: AssistantEvent[], seenToolCount: { value: number } = { value: 2 }): AssistantRunner {
  return {
    getToolCount: async () => seenToolCount.value,
    async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function makeDeps(overrides: Partial<TurnManagerDeps> = {}) {
  const events: TurnEvent[] = [];
  const messages: { content: string; role: MessageRole; conversationId: string; error?: string; metadata?: unknown }[] =
    [];

  const deps: TurnManagerDeps = {
    conversations: {
      async createConversation() {
        return { id: 'conv_created' };
      },
      async conversationExists(id: string) {
        return id === 'conv_existing';
      },
    },
    messages: {
      async createMessage(content, role, conversationId, _attachments?, error?, metadata?) {
        const recorded = { content, role, conversationId, error, metadata };
        messages.push(recorded);
        return recorded;
      },
      async getMessagesByConversation(conversationId: string): Promise<Message[]> {
        return [
          {
            id: 'm1',
            content: 'research topic',
            role: MessageRole.USER,
            conversationId,
            createdAt: new Date(),
            attachments: [],
          } as Message,
        ];
      },
    },
    getConfig: () => ({ providers: [provider] }) as unknown as ReturnType<TurnManagerDeps['getConfig']>,
    resolveKey: async () => 'sk-test',
    gateway: {
      async *chatStream() {
        yield 'unused';
      },
    },
    broadcast: (event: TurnEvent) => {
      events.push(event);
    },
    ...overrides,
  };

  return { deps, events, messages };
}

const request = {
  conversationId: 'conv_existing',
  content: 'research topic',
  modelId: 'test-model',
  providerId: 'p1',
  flow: 'research' as const,
};

describe('TurnManager research flow routing (plan 13 S6)', () => {
  it('routes flow=research turns through the research runner', async () => {
    setToolCallAuditSink(async () => undefined);
    const researchRunner = flowRunner([
      { type: 'node_started', node: 'plan', label: 'Planning', resumed: false },
      { type: 'node_finished', node: 'plan', label: 'Planning', outcome: 'done', durationMs: 4, resumed: false },
      { type: 'node_started', node: 'search', label: 'Searching the web', resumed: false },
      {
        type: 'tool_calls',
        calls: [{ id: 'search_r1_1', name: 'web_search', args: { query: 'topic' }, summary: 'Searched the web for “topic”', risk: 'read-only' }],
      },
      { type: 'tool_results', results: [{ id: 'search_r1_1', summary: 'Web results via fake:', isError: false }] },
      { type: 'node_finished', node: 'search', label: 'Searching the web', outcome: 'done', durationMs: 6, resumed: false },
      { type: 'final', text: 'Research report.' },
    ]);
    const { deps, events, messages } = makeDeps({ researchRunner });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });

    expect(events.map((event) => event.phase)).toEqual([
      'queued',
      'thinking',
      'thinking',
      'thinking',
      'tool_call',
      'tool_result',
      'thinking',
      'finished',
    ]);
    const steps = events.at(-1)?.steps ?? [];
    expect(steps.map((step) => step.node ?? step.toolName)).toEqual(['plan', 'search', 'web_search']);
    expect((messages[1].metadata as TurnMetadata)).toMatchObject({ outcome: 'ok', toolCount: 1 });
    expect(messages[1].content).toBe('Research report.');
  });

  it('fails the turn gracefully when no research runner is wired', async () => {
    const { deps, events, messages } = makeDeps({});

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('failed');
    });
    expect(events.at(-1)?.error).toContain('research');
    expect((messages[1].metadata as TurnMetadata).outcome).toBe('failed');
    expect(messages[1].error).toContain('research');
  });

  it('keeps ordinary turns on the standard agent path when no flow is requested', async () => {
    const researchRunner = flowRunner([{ type: 'final', text: 'never used' }], { value: 0 });
    const agentRunner = flowRunner([{ type: 'final', text: 'agent answer' }], { value: 2 });
    const { deps, events } = makeDeps({ researchRunner, agent: agentRunner });

    const manager = new TurnManager(deps);
    await manager.start({ ...request, flow: undefined });

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect((events.at(-1)?.steps ?? []).some((step) => step.node === 'plan' || step.node === 'search')).toBe(false);
  });
});
