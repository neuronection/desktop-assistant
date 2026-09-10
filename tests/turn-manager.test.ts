import { describe, it, expect, vi } from 'vitest';
import { TurnManager, type TurnManagerDeps } from '@main/turns/TurnManager';
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

interface RecordedMessage {
  content: string;
  role: MessageRole;
  conversationId: string;
  attachments?: unknown;
  error?: string;
  metadata?: unknown;
}

function makeDeps(overrides: Partial<TurnManagerDeps> = {}) {
  const events: TurnEvent[] = [];
  const messages: RecordedMessage[] = [];
  const createdTitles: string[] = [];
  const sequence: string[] = [];
  const existingIds = new Set(['conv_existing']);

  const deps: TurnManagerDeps = {
    conversations: {
      async createConversation(title: string) {
        createdTitles.push(title);
        return { id: 'conv_created' };
      },
      async conversationExists(id: string) {
        return existingIds.has(id);
      },
    },
    messages: {
      async createMessage(
        content: string,
        role: MessageRole,
        conversationId: string,
        attachments?: unknown,
        error?: string,
        metadata?: unknown
      ) {
        const recorded = { content, role, conversationId, attachments, error, metadata };
        messages.push(recorded);
        sequence.push(`persist:${role}`);
        return recorded;
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
      async *chatStream() {
        yield 'He';
        yield 'llo';
      },
    },
    broadcast: (event: TurnEvent) => {
      events.push(event);
      sequence.push(`event:${event.phase}`);
    },
    ...overrides,
  };

  return { deps, events, messages, createdTitles, sequence };
}

const request = {
  conversationId: 'conv_existing',
  content: 'hello there',
  modelId: 'test-model',
  providerId: 'p1',
};

function phases(events: TurnEvent[]): string[] {
  return events.map((event) => event.phase);
}

describe('TurnManager', () => {
  it('runs a happy-path turn with ordered phases and persistence', async () => {
    const { deps, events, messages } = makeDeps();

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(phases(events)).toContain('finished');
    });

    expect(phases(events).slice(0, 5)).toEqual(['queued', 'thinking', 'streaming', 'streaming', 'finished']);
    const seqs = events.map((event) => event.seq);
    expect(seqs[0]).toBe(1);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const firstDelta = events.find((event) => event.phase === 'streaming');
    expect(firstDelta?.delta).toBe('He');
    expect(firstDelta?.step).toMatchObject({ phase: 'thinking', endedAt: expect.any(Number) });

    const finished = events.at(-1);
    expect(finished).toMatchObject({ model: 'test-model', durationMs: expect.any(Number) });
    expect(finished?.steps?.[0]).toMatchObject({ phase: 'thinking' });

    expect(messages[0]).toMatchObject({ role: MessageRole.USER, conversationId: 'conv_existing', content: 'hello there' });
    expect(messages[1]).toMatchObject({ role: MessageRole.ASSISTANT, content: 'Hello' });
    expect((messages[1].metadata as { outcome: string }).outcome).toBe('ok');
  });

  it('broadcasts terminal phases only after the assistant message is persisted', async () => {
    const { deps, sequence } = makeDeps();
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(sequence).toContain('event:finished');
    });

    expect(sequence.indexOf('persist:assistant')).toBeGreaterThan(-1);
    expect(sequence.indexOf('persist:assistant')).toBeLessThan(sequence.indexOf('event:finished'));
  });

  it('broadcasts the failed phase only after the error message is persisted', async () => {
    const { deps, sequence } = makeDeps({
      gateway: {
        async *chatStream() {
          yield 'par';
          throw new Error('boom');
        },
      },
    });
    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(sequence).toContain('event:failed');
    });

    expect(sequence.indexOf('persist:assistant')).toBeLessThan(sequence.indexOf('event:failed'));
  });

  it('creates the conversation for temp ids and truncates the title', async () => {
    const { deps, createdTitles } = makeDeps();
    const manager = new TurnManager(deps);
    await manager.start({ ...request, conversationId: 'temp-abc', content: 'x'.repeat(60) });

    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    expect(createdTitles).toEqual(['x'.repeat(40) + '...']);
  });

  it('rejects unresolvable models without emitting events', async () => {
    const missing = makeDeps({ getConfig: () => ({ providers: [] }) as unknown as ReturnType<TurnManagerDeps['getConfig']> });
    await expect(new TurnManager(missing.deps).start(request)).rejects.toThrow(/No model is assigned/);
    expect(missing.events).toEqual([]);

    const noKey = makeDeps({ resolveKey: async () => '' });
    await expect(new TurnManager(noKey.deps).start(request)).rejects.toThrow(/API key/);
    expect(noKey.events).toEqual([]);
  });

  it('rejects a second start while a turn is active and allows restart after completion', async () => {
    const { deps } = makeDeps();
    const manager = new TurnManager(deps);
    await manager.start(request);
    await expect(manager.start(request)).rejects.toThrow(/already in progress/);
    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    await expect(manager.start(request)).resolves.toEqual(expect.stringMatching(/^turn_/));
  });

  it('reports failure and persists an error message', async () => {
    const { deps, events, messages } = makeDeps({
      gateway: {
        async *chatStream() {
          yield 'par';
          throw new Error('boom');
        },
      },
    });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(phases(events)).toContain('failed');
    });

    const failed = events.at(-1);
    expect(failed?.error).toBe('boom');
    expect(messages[1]).toMatchObject({ error: 'boom' });
    expect((messages[1].metadata as { outcome: string }).outcome).toBe('failed');
  });

  it('cancels mid-stream and persists the partial content as cancelled', async () => {
    const tokens: string[] = [];
    let release: (() => void) | null = null;
    const { deps, events, messages } = makeDeps({
      gateway: {
        chatStream: async function* () {
          while (true) {
            if (tokens.length > 0) {
              yield tokens.shift() as string;
              continue;
            }
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
        },
      },
    });

    const manager = new TurnManager(deps);
    tokens.push('partial');
    await manager.start(request);

    await vi.waitFor(() => {
      expect(phases(events)).toContain('streaming');
    });
    expect(manager.isActive()).toBe(true);

    expect(manager.cancel()).toBe(true);
    await vi.waitFor(() => {
      expect(phases(events)).toContain('cancelled');
    });

    expect(events.at(-1)).toMatchObject({ durationMs: expect.any(Number) });
    expect(messages[1]).toMatchObject({ content: 'partial' });
    expect((messages[1].metadata as { outcome: string }).outcome).toBe('cancelled');
    expect(manager.isActive()).toBe(false);
    expect(manager.cancel()).toBe(false);
  });

  it('skips persisting an empty completed turn', async () => {
    const { deps, messages } = makeDeps({
      gateway: { async *chatStream() {} },
    });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    expect(messages).toHaveLength(1);
  });

  it('generates a title for the first exchange when the titles task is assigned', async () => {
    const chat = vi.fn(async () => '  "A Chat About Testing"  ');
    const getConversationById = vi.fn(async () => ({ id: 'conv_existing', title: 'hello there' }));
    const updateConversation = vi.fn(async () => ({}));
    const { deps } = makeDeps({
      getConfig: () =>
        ({
          providers: [provider],
          taskAssignments: { chat: 'test-model', titles: 'test-model' },
        }) as unknown as ReturnType<TurnManagerDeps['getConfig']>,
      gateway: {
        async *chatStream() {
          yield 'Hello';
        },
        chat,
      },
      conversations: {
        async createConversation(title: string) {
          return { id: 'conv_created' };
        },
        async conversationExists(id: string) {
          return true;
        },
        getConversationById,
        updateConversation,
      },
    });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(updateConversation).toHaveBeenCalledWith('conv_existing', { title: 'A Chat About Testing' });
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'titles', modelId: 'test-model' })
    );
  });

  it('does not generate titles when the titles task is unassigned', async () => {
    const chat = vi.fn(async () => 'Title');
    const { deps } = makeDeps({
      gateway: {
        async *chatStream() {
          yield 'Hello';
        },
        chat,
      },
    });

    const manager = new TurnManager(deps);
    await manager.start(request);

    await vi.waitFor(() => {
      expect(manager.isActive()).toBe(false);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chat).not.toHaveBeenCalled();
  });
});
