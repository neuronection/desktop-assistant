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
