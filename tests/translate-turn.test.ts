import { describe, it, expect, vi, beforeEach } from 'vitest';

const { translate } = vi.hoisted(() => ({
  translate: vi.fn(),
}));

vi.mock('@main/services/TranslateService', () => ({
  TranslateService: { getInstance: () => ({ translate }) },
  translationProviderSecretKey: (id: string) => `translation:${id}:key`,
}));

import { TurnManager, type TurnManagerDeps, type TurnManagerTools } from '@main/turns/TurnManager';
import { buildDefaultToolRegistry } from '@main/ai/tools/native';

const registry = buildDefaultToolRegistry();

function tools(): TurnManagerTools {
  return {
    riskFor: (name) => registry.riskFor(name),
    summarizeFor: (name, args) => registry.summarizeFor(name, args),
    editableArgs: () => false,
    requestedRoots: () => [],
    executeDirect: (name, args, ctx) => registry.executeDirect(name, args, ctx),
  };
}

type TurnEvent2 = Parameters<TurnManagerDeps['broadcast']>[0];

function makeDeps() {
  const events: TurnEvent2[] = [];
  const messages: { content: string; role: string; conversationId: string; error?: string; metadata?: unknown }[] = [];
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
      async createMessage(content, _role, conversationId, _attachments?, error?, metadata?) {
        const recorded = { content, role: String(_role), conversationId, error, metadata };
        messages.push(recorded);
        return recorded;
      },
      async getMessagesByConversation() {
        return [];
      },
    },
    getConfig: () => ({ providers: [] }) as unknown as TurnManagerDeps['getConfig'],
    resolveKey: async () => 'sk-test',
    gateway: {
      async *chatStream() {
        yield 'unused';
      },
    },
    broadcast: (event: TurnEvent2) => {
      events.push(event);
    },
    tools: tools(),
  };
  return { deps, events, messages };
}

const baseRequest = {
  conversationId: 'conv_existing',
  modelId: '',
  providerId: '',
};

describe('/tr turn path — event-driven through the real registry (plan 19 S3)', () => {
  beforeEach(() => {
    translate.mockReset();
  });

  it('runs the translate tool directly (no model call) and renders the meta line', async () => {
    translate.mockResolvedValue({ text: 'Καλημέρα', engine: 'deepl', target: 'el', source: 'en' });
    const { deps, events, messages } = makeDeps();
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      content: '/tr el Good morning',
      directTool: { name: 'translate', args: { text: 'Good morning', target: 'el' } },
    });

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('finished');
    });
    expect(events.map((event) => event.phase)).toEqual(['queued', 'tool_call', 'tool_result', 'finished']);
    expect(translate).toHaveBeenCalledWith({ text: 'Good morning', target: 'el' }, { signal: undefined });

    const resultEvent = events.find((event) => event.phase === 'tool_result');
    expect(resultEvent).toBeDefined();
    const persisted = messages.find((message) => message.role === 'assistant');
    expect(persisted?.content).toContain('Καλημέρα');
    expect(persisted?.content).toContain('via DeepL · en → el');
  });

  it('surfaces typed engine failures as an errored step, not a crash', async () => {
    translate.mockRejectedValue(new Error('Translation is not configured. Add a translation service or assign a translation model in settings.'));
    const { deps, events, messages } = makeDeps();
    const manager = new TurnManager(deps);
    await manager.start({
      ...baseRequest,
      content: '/tr hello',
      directTool: { name: 'translate', args: { text: 'hello' } },
    });

    await vi.waitFor(() => {
      expect(events.at(-1)?.phase).toBe('failed');
    });
    expect(events.map((event) => event.phase)).toEqual(['queued', 'tool_call', 'tool_result', 'failed']);
    const resultEvent = events.find((event) => event.phase === 'tool_result');
    expect(resultEvent).toBeDefined();
    const step = (resultEvent as unknown as { step?: { status?: string; response?: string } }).step;
    expect(step?.status).toBe('error');
    expect(step?.response).toContain('Error (translate)');
    expect(step?.response).toContain('Translation is not configured');
  });
});
