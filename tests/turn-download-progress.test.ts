import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TurnManager, type TurnManagerDeps } from '@main/turns/TurnManager';
import type { AssistantRunner, AssistantEvent } from '@main/ai/graphs/assistant';
import { downloads } from '@main/ai/tools/downloads';
import { setToolCallAuditSink } from '@main/ai/audit';
import { MessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import type { LLMProvider } from '@shared/types';
import type { TurnEvent } from '@shared/turns';

const provider = {
  id: 'p1',
  systemPrompt: '',
  availableModels: [{ id: 'test-model', name: 'Test Model', providerType: 'openai', providerId: 'p1' }],
} as unknown as LLMProvider;

beforeEach(() => {
  downloads.reset();
  setToolCallAuditSink(null);
});

afterEach(() => {
  downloads.reset();
});

function makeDeps(overrides: Partial<TurnManagerDeps> = {}): { deps: TurnManagerDeps; events: TurnEvent[]; messages: { metadata?: { steps?: unknown[] } }[] } {
  const events: TurnEvent[] = [];
  const messages: { metadata?: { steps?: unknown[] } }[] = [];
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

describe('download progress rides the turn envelope (agent path)', () => {
  it('mirrors tracker events onto the open download step, then closes it', async () => {
    const script: AssistantEvent[] = [
      {
        type: 'tool_calls',
        calls: [
          {
            id: 'c1',
            name: 'download_file',
            args: { url: 'https://example.com/a.zip' },
            summary: 'Download https://example.com/a.zip',
            risk: 'state-changing',
          },
        ],
      },
      {
        type: 'tool_results',
        results: [{ id: 'c1', summary: 'Saved /tmp/a.zip (2.0 MB)', isError: false }],
      },
      { type: 'final', text: 'Saved it.' },
    ];
    let release: (() => void) | null = null;
    const duringDownload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield script[0];
        await duringDownload;
        yield script[1];
        yield script[2];
      },
    };

    const { deps, events, messages } = makeDeps({ agent: runner });
    const manager = new TurnManager(deps);
    await manager.start({ conversationId: 'conv_existing', content: 'get it', modelId: 'test-model' });

    await vi.waitFor(() => {
      const open = events.find((event) => event.step?.id === 'tool_c1');
      expect(open).toBeTruthy();
    });

    const handle = downloads.begin('/tmp/a.zip');
    handle.report(512, 1024);
    await vi.waitFor(() => {
      const active = events.filter((event) => event.step?.progress?.status === 'active').at(-1);
      expect(active?.step?.progress).toMatchObject({
        downloadId: handle.id,
        destination: '/tmp/a.zip',
        loadedBytes: 512,
        totalBytes: 1024,
        status: 'active',
      });
    });

    handle.report(1024, 1024);
    handle.finish('done');
    release?.();

    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });
    const closed = events.find((event) => event.step?.id === 'tool_c1' && event.step?.endedAt !== undefined);
    expect(closed).toBeTruthy();

    const persisted = messages
      .map((entry) => entry.metadata as { steps?: { id: string; progress?: unknown }[] } | undefined)
      .filter((metadata) => metadata?.steps?.length)
      .at(-1);
    const persistedStep = persisted?.steps?.find((step) => step.id === 'tool_c1');
    expect(persistedStep).toBeTruthy();
  });
});

describe('file artifacts ride the turn envelope', () => {
  it('the agent path extracts the marker from tool results into the finished event + metadata', async () => {
    const savedText = `Saved /tmp/a.zip (2.0 KB).\n[artifact] {"kind":"file","path":"/tmp/a.zip","name":"a.zip","sizeBytes":2048}`;
    const runner: AssistantRunner = {
      getToolCount: async () => 1,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield {
          type: 'tool_calls',
          calls: [
            { id: 'c1', name: 'download_file', args: { url: 'https://example.com/a.zip' }, summary: 'Download', risk: 'state-changing' },
          ],
        };
        yield { type: 'tool_results', results: [{ id: 'c1', summary: 'Saved /tmp/a.zip', isError: false, content: savedText }] };
        yield { type: 'final', text: 'Done.' };
      },
    };
    const { deps, events, messages } = makeDeps({ agent: runner });
    const manager = new TurnManager(deps);
    await manager.start({ conversationId: 'conv_existing', content: 'get it', modelId: 'test-model' });
    await vi.waitFor(() => {
      expect(events[events.length - 1]?.phase).toBe('finished');
    });
    const finished = events[events.length - 1];
    expect(finished.artifacts).toEqual([
      { kind: 'file', path: '/tmp/a.zip', name: 'a.zip', sizeBytes: 2048 },
    ]);
    const persisted = messages
      .map((entry) => entry.metadata as { artifacts?: unknown[] } | undefined)
      .filter((metadata) => metadata?.artifacts)
      .at(-1);
    expect(persisted?.artifacts).toHaveLength(1);
  });

  it('the direct path extracts the marker from the tool output', async () => {
    const tools = {
      riskFor: (name: string) => (name === 'download_file' ? 'state-changing' : undefined) as 'state-changing' | undefined,
      summarizeFor: (_name: string, args: { url?: string }) => `Download ${args.url ?? ''}`,
      editableArgs: () => true,
      async executeDirect(): Promise<{ ok: boolean; text: string; images: string[]; durationMs: number }> {
        return {
          ok: true,
          text: 'Saved /tmp/direct.zip (9.0 KB).\n[artifact] {"kind":"file","path":"/tmp/direct.zip","name":"direct.zip","sizeBytes":9216}',
          images: [],
          durationMs: 4,
        };
      },
    };
    const { deps, events } = makeDeps({ tools: tools as never });
    const manager = new TurnManager(deps);
    await manager.start({
      conversationId: 'conv_existing',
      content: '/download https://example.com/direct.zip',
      directTool: { name: 'download_file', args: { url: 'https://example.com/direct.zip' } },
    });
    await vi.waitFor(() => {
      expect(events[events.length - 1]?.phase).toBe('finished');
    });
    expect(events[events.length - 1].artifacts).toEqual([
      { kind: 'file', path: '/tmp/direct.zip', name: 'direct.zip', sizeBytes: 9216 },
    ]);
  });

  it('turns without artifact markers carry no artifacts', async () => {
    const runner: AssistantRunner = {
      getToolCount: async () => 0,
      async *run(): AsyncGenerator<AssistantEvent, void, unknown> {
        yield { type: 'final', text: 'Plain answer.' };
      },
    };
    const { deps, events } = makeDeps({ agent: runner });
    const manager = new TurnManager(deps);
    await manager.start({ conversationId: 'conv_existing', content: 'hi', modelId: 'test-model' });
    await vi.waitFor(() => {
      expect(events[events.length - 1]?.phase).toBe('finished');
    });
    expect(events[events.length - 1].artifacts).toBeUndefined();
  });
});

describe('download progress rides the turn envelope (direct path)', () => {
  const tools = {
    riskFor: (name: string) => (name === 'download_file' ? 'state-changing' : undefined) as 'state-changing' | undefined,
    summarizeFor: (name: string, args: { url?: string }) => `Download ${args.url ?? name}`,
    editableArgs: () => true,
    async executeDirect(
      _name: string,
      _args: unknown,
      _ctx: { grantedRoots?: string[] },
      hook?: (handle: ReturnType<typeof downloads.begin>) => Promise<void>
    ): Promise<{ ok: boolean; text: string; images: string[]; durationMs: number }> {
      const handle = downloads.begin('/tmp/direct.zip');
      handle.report(256, 512);
      if (hook) {
        await hook(handle);
      }
      handle.finish('done');
      return { ok: true, text: 'Saved /tmp/direct.zip (512 B)', images: [], durationMs: 5 };
    },
  };

  it('streams progress into the open tool step of a direct turn', async () => {
    const { deps, events } = makeDeps({ tools: tools as never });
    const manager = new TurnManager(deps);
    await manager.start({
      conversationId: 'conv_existing',
      content: '/download https://example.com/direct.zip',
      directTool: { name: 'download_file', args: { url: 'https://example.com/direct.zip' } },
    });
    await vi.waitFor(() => {
      expect(events.some((event) => event.phase === 'finished')).toBe(true);
    });
    const withProgress = events
      .filter((event) => event.step?.progress?.status === 'active')
      .at(-1);
    expect(withProgress?.step?.toolName).toBe('download_file');
    expect(withProgress?.step?.progress).toMatchObject({ loadedBytes: 256, totalBytes: 512 });
  });

  it('turn cancel aborts in-flight downloads and the turn ends cancelled', async () => {
    let cancelledSeen: (() => void) | null = null;
    const cancelledPromise = new Promise<void>((resolve) => {
      cancelledSeen = resolve;
    });
    const hangingTools = {
      ...tools,
      async executeDirect(): Promise<{ ok: boolean; text: string; images: string[]; durationMs: number }> {
        const handle = downloads.begin('/tmp/hanging.zip');
        handle.report(10, 100);
        await cancelledPromise;
        handle.finish('cancelled');
        return { ok: true, text: 'Download cancelled — the partial file was removed.', images: [], durationMs: 3 };
      },
    };
    const { deps, events } = makeDeps({ tools: hangingTools as never });
    const manager = new TurnManager(deps);
    await manager.start({
      conversationId: 'conv_existing',
      content: '/download https://example.com/hanging.zip',
      directTool: { name: 'download_file', args: { url: 'https://example.com/hanging.zip' } },
    });
    await vi.waitFor(() => {
      expect(events.some((event) => event.step?.progress?.status === 'active')).toBe(true);
    });
    expect(manager.cancel()).toBe(true);
    cancelledSeen?.();
    await vi.waitFor(() => {
      expect(events[events.length - 1]?.phase).toBe('cancelled');
    });
    expect(events.some((event) => event.step?.progress?.status === 'cancelled')).toBe(true);
  });
});
