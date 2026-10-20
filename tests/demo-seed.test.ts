import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPath = vi.fn(() => '/fake/user-data');
const setPath = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: (...args: unknown[]) => getPath(...args),
    setPath: (...args: unknown[]) => setPath(...args),
  },
}));

type CreatedConversation = { id: string; title: string };
type CreatedMessage = { id: string; conversationId: string; role: string };

const makeDb = (existing: CreatedConversation[] = []) => {
  const conversations = [...existing];
  const messages: CreatedMessage[] = [];
  return {
    conversations,
    messages,
    db: {
      conversation: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          conversations.find((c) => c.id === where.id) ?? null,
        create: async ({ data }: { data: CreatedConversation }) => {
          conversations.push(data);
          return data;
        },
      },
      message: {
        create: async ({ data }: { data: CreatedMessage }) => {
          messages.push(data);
          return data;
        },
      },
    },
  };
};

describe('demo mode flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isDemoLaunch matches only an explicit --demo argv', async () => {
    const { isDemoLaunch, DEMO_FLAG } = await import('@main/demo');
    expect(DEMO_FLAG).toBe('--demo');
    expect(isDemoLaunch(['electron .', '--hidden'])).toBe(false);
    expect(isDemoLaunch([])).toBe(false);
    expect(isDemoLaunch(['electron .', '--demo'])).toBe(true);
  });

  it('applyDemoDataDir redirects userData into an isolated demo subdir', async () => {
    const { applyDemoDataDir } = await import('@main/demo');
    const dir = applyDemoDataDir();
    expect(dir).toBe('/fake/user-data/demo');
    expect(setPath).toHaveBeenCalledWith('userData', '/fake/user-data/demo');
  });
});

describe('demo config provisioning', () => {
  const makeConfig = (initial: Record<string, unknown>) => {
    let config = { ...initial };
    const updateConfig = vi.fn(async (updates: Record<string, unknown>) => {
      config = { ...config, ...updates };
    });
    return {
      getConfig: () => config,
      updateConfig,
      current: () => config as Record<string, unknown>,
    };
  };

  const keylessProvider = {
    id: 'openai-default',
    name: 'OpenAI Default',
    type: 'openai',
    apiKey: '',
    apiBase: 'https://api.openai.com/v1',
    timeout: 120000,
    maxTokens: 2000,
    systemPrompt: '',
    availableModels: [],
    customModels: [],
  };

  it('provisions the local assistant, search and translate providers on an unconfigured demo', async () => {
    const {
      applyDemoConfig,
      DEMO_MODEL_ID,
      DEMO_PROVIDER_ID,
      DEMO_SEARCH_ID,
      DEMO_ASSISTANT_PORT,
      DEMO_SEARCH_PORT,
    } = await import('@main/demo');
    const config = makeConfig({
      providers: [keylessProvider],
      defaultProviderId: keylessProvider.id,
      defaultChatModelId: null,
      taskAssignments: { chat: null },
      search: { providers: [] },
      translation: { mode: 'auto', providers: [], customLanguages: [], padDebounceMs: 1500 },
    });

    await applyDemoConfig(config as never);

    const next = config.current() as {
      providers: Array<{ id: string; apiBase: string; availableModels: Array<{ id: string }> }>;
      defaultProviderId: string;
      defaultChatModelId: string;
      taskAssignments: Record<string, string | null>;
      search: { providers: Array<{ id: string; baseUrl: string }> };
      translation: { providers: Array<{ type: string }> };
    };
    const provider = next.providers.find((row) => row.id === DEMO_PROVIDER_ID);
    expect(provider).toBeTruthy();
    expect(provider?.apiBase).toContain(`:${DEMO_ASSISTANT_PORT}`);
    expect(provider?.availableModels.some((model) => model.id === DEMO_MODEL_ID)).toBe(true);
    expect(next.defaultProviderId).toBe(DEMO_PROVIDER_ID);
    expect(next.defaultChatModelId).toBe(DEMO_MODEL_ID);
    expect(next.taskAssignments.chat).toBe(DEMO_MODEL_ID);
    expect(next.search.providers[0]?.id).toBe(DEMO_SEARCH_ID);
    expect(next.search.providers[0]?.baseUrl).toContain(`:${DEMO_SEARCH_PORT}`);
    expect(next.translation.providers[0]?.type).toBe('libretranslate');
  });

  it('leaves a configured provider and existing providers untouched', async () => {
    const { applyDemoConfig, DEMO_PROVIDER_ID } = await import('@main/demo');
    const configured = { ...keylessProvider, id: 'real', apiKeyHint: 'sk-…' };
    const config = makeConfig({
      providers: [configured],
      defaultChatModelId: 'real-model',
      taskAssignments: { chat: 'real-model' },
      search: { providers: [{ id: 'real-search', type: 'brave', enabled: true }] },
      translation: { mode: 'service', providers: [{ id: 'real-translate' }] },
    });

    await applyDemoConfig(config as never);

    expect(config.updateConfig).not.toHaveBeenCalled();
    expect((config.current() as { providers: Array<{ id: string }> }).providers.some((row) => row.id === DEMO_PROVIDER_ID)).toBe(false);
  });

  it('is idempotent: the second boot writes nothing', async () => {
    const { applyDemoConfig } = await import('@main/demo');
    const config = makeConfig({
      providers: [keylessProvider],
      defaultChatModelId: null,
      taskAssignments: { chat: null },
      search: { providers: [] },
      translation: { mode: 'auto', providers: [], customLanguages: [], padDebounceMs: 1500 },
    });

    await applyDemoConfig(config as never);
    expect(config.updateConfig).toHaveBeenCalledTimes(1);
    await applyDemoConfig(config as never);
    expect(config.updateConfig).toHaveBeenCalledTimes(1);
  });
});

describe('demo workspace seeding', () => {
  it('seeds sample conversations with fixed ids, content only', async () => {
    const { seedDemoWorkspace } = await import('@main/demo');
    const { db, conversations, messages } = makeDb();
    const seeded = await seedDemoWorkspace(db as never);

    expect(seeded).toBeGreaterThan(0);
    expect(conversations.length).toBe(seeded);
    expect(messages.length).toBeGreaterThan(conversations.length);
    for (const conversation of conversations) {
      expect(conversation.id).toMatch(/^demo-conv-/);
    }
    for (const message of messages) {
      expect(message.id).toMatch(/^demo-msg-/);
      expect(conversations).toContainEqual(
        expect.objectContaining({ id: message.conversationId })
      );
    }
  });

  it('is idempotent: an already-seeded demo database is left untouched', async () => {
    const { seedDemoWorkspace, DEMO_CONVERSATIONS } = await import('@main/demo');
    const existing = DEMO_CONVERSATIONS.map((c) => ({ id: c.id, title: c.title }));
    const { db, conversations, messages } = makeDb(existing);

    const seeded = await seedDemoWorkspace(db as never);

    expect(seeded).toBe(0);
    expect(conversations).toHaveLength(existing.length);
    expect(messages).toHaveLength(0);
  });
});
