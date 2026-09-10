import { describe, it, expect, vi } from 'vitest';
import { TurnManager, buildMemoryContextBlock, type TurnManagerDeps } from '@main/turns/TurnManager';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type { LLMProvider } from '@shared/types';
import type { TurnEvent } from '@shared/turns';

const provider: LLMProvider = {
  id: 'p1',
  name: 'Test',
  type: 'openai' as unknown as LLMProvider['type'],
  apiKey: '',
  apiBase: 'http://localhost:11434/v1',
  availableModels: [
    { id: 'test-model', name: 'Test Model', providerType: 'openai' as unknown as LLMProvider['type'], providerId: 'p1' },
  ],
} as unknown as LLMProvider;

function makeDeps(overrides: Partial<TurnManagerDeps> = {}) {
  const events: TurnEvent[] = [];
  const seenStreams: { messages: unknown }[] = [];

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
      async createMessage(content: string, role: MessageRole, conversationId: string) {
        return { content, role, conversationId };
      },
      async getMessagesByConversation(conversationId: string): Promise<Message[]> {
        return [
          {
            id: 'm1',
            content: 'hello',
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
      chatStream: Object.assign(
        async function* (payload: { messages: unknown }) {
          seenStreams.push(payload);
          yield 'Hello';
        },
        {}
      ),
    },
    broadcast: (event: TurnEvent) => events.push(event),
    ...overrides,
  };

  return { deps, events, seenStreams };
}

const request = {
  conversationId: 'conv_existing',
  content: 'what is my deploy user?',
  modelId: 'test-model',
  providerId: 'p1',
};

function systemTexts(messages: unknown): string[] {
  return (messages as { role: string; content: string }[])
    .filter((message) => message.role === 'system')
    .map((message) => message.content);
}

describe('TurnManager memory recall', () => {
  it('injects recalled memories as a system message and emits the marker step', async () => {
    const recall = vi.fn(async () => ['Deploy user is admin', 'Prefers dark mode']);
    const { deps, events, seenStreams } = makeDeps({ memories: { recall } });

    const manager = new TurnManager(deps);
    await manager.start(request);
    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });

    expect(recall).toHaveBeenCalledWith(request.content);
    expect(seenStreams).toHaveLength(1);
    const systems = systemTexts(seenStreams[0].messages);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toBe(buildMemoryContextBlock(['Deploy user is admin', 'Prefers dark mode']));

    const marker = events
      .map((event) => event.step)
      .find((step) => step?.label === 'Context');
    expect(marker).toMatchObject({
      phase: 'thinking',
      summary: '2 memories recalled',
    });
    const finished = events.at(-1);
    const closedMarker = finished?.steps?.find((step) => step.label === 'Context');
    expect(closedMarker).toMatchObject({
      phase: 'thinking',
      summary: '2 memories recalled',
      endedAt: expect.any(Number),
    });
  });

  it('skips injection when behavior.memoryContext is off', async () => {
    const recall = vi.fn(async () => ['Deploy user is admin']);
    const { deps, events, seenStreams } = makeDeps({
      memories: { recall },
      getConfig: () =>
        ({ providers: [provider], behavior: { memoryContext: false } }) as unknown as ReturnType<
          TurnManagerDeps['getConfig']
        >,
    });

    const manager = new TurnManager(deps);
    await manager.start(request);
    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });

    expect(recall).not.toHaveBeenCalled();
    expect(seenStreams[0].messages ? systemTexts(seenStreams[0].messages) : []).toHaveLength(0);
    expect(events.some((event) => event.step?.label === 'Context')).toBe(false);
  });

  it('survives a failing memory store and runs the turn without context', async () => {
    const recall = vi.fn(async () => {
      throw new Error('db gone');
    });
    const { deps, events, seenStreams } = makeDeps({ memories: { recall } });

    const manager = new TurnManager(deps);
    await manager.start(request);
    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });

    expect(recall).toHaveBeenCalled();
    expect(seenStreams[0].messages ? systemTexts(seenStreams[0].messages) : []).toHaveLength(0);
    expect(events.some((event) => event.step?.label === 'Context')).toBe(false);
  });

  it('does not recall for direct-tool turns', async () => {
    const recall = vi.fn(async () => ['unused']);
    const executeDirect = vi.fn(async () => ({ ok: true, text: 'done', durationMs: 5 }));
    const { deps, events } = makeDeps({
      memories: { recall },
      tools: {
        riskFor: () => 'read-only',
        summarizeFor: () => 'Do thing',
        editableArgs: () => false,
        executeDirect,
      },
    });

    const manager = new TurnManager(deps);
    await manager.start({ ...request, directTool: { name: 'memory_list', args: {} } });
    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });

    expect(recall).not.toHaveBeenCalled();
    expect(executeDirect).toHaveBeenCalled();
  });
});
