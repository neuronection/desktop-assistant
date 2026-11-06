import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageRole } from '@shared/types';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { DatabaseService } = await import('@main/services/DatabaseService');
const { ConversationService } = await import('@main/services/ConversationService');
const { MessageService } = await import('@main/services/MessageService');

let dir: string | null = null;

afterEach(async () => {
  delete process.env.DESKTOP_ASSISTANT_DATA_DIR;
  if (dir) {
    await rm(dir, { recursive: true, force: true });
    dir = null;
  }
});

async function freshServices(): Promise<{
  conversations: InstanceType<typeof ConversationService>;
  messages: InstanceType<typeof MessageService>;
}> {
  dir = await mkdtemp(path.join(tmpdir(), 'da-conversation-service-'));
  process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
  const database = new DatabaseService();
  await database.initialize();
  const conversations = new ConversationService(database);
  return { conversations, messages: new MessageService(database, conversations) };
}

async function freshService(): Promise<InstanceType<typeof ConversationService>> {
  return (await freshServices()).conversations;
}

describe('ConversationService (plan 46 S2)', () => {
  it('creates, lists and reads conversations', async () => {
    const conversations = await freshService();
    const created = await conversations.createConversation('first chat');
    expect(created.title).toBe('first chat');
    expect(created.isArchived).toBe(false);
    expect((await conversations.getAllConversations()).map((row) => row.id)).toContain(created.id);
    expect((await conversations.getConversationById(created.id))?.title).toBe('first chat');
    expect(await conversations.conversationExists(created.id)).toBe(true);
  });

  it('paginates newest-first', async () => {
    const conversations = await freshService();
    const a = await conversations.createConversation('a');
    const b = await conversations.createConversation('b');
    const c = await conversations.createConversation('c');
    const page = await conversations.getConversationsPaginated(1, 2);
    expect(page.total).toBe(3);
    expect(page.pages).toBe(2);
    expect(page.conversations.map((row) => row.id)).toEqual([c.id, b.id]);
    const secondPage = await conversations.getConversationsPaginated(2, 2);
    expect(secondPage.conversations.map((row) => row.id)).toEqual([a.id]);
  });

  it('updates the title and touches the timestamp', async () => {
    const conversations = await freshService();
    const created = await conversations.createConversation('before');
    const before = (await conversations.getConversationById(created.id))?.updatedAt;
    await conversations.updateConversation(created.id, { title: 'after' });
    const updated = await conversations.getConversationById(created.id);
    expect(updated?.title).toBe('after');
    await conversations.touchConversation(created.id);
    const touched = await conversations.getConversationById(created.id);
    expect(new Date(touched!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before!).getTime());
  });

  it('archives and unarchives', async () => {
    const conversations = await freshService();
    const created = await conversations.createConversation('to archive');
    const archived = await conversations.archiveConversation(created.id);
    expect(archived.isArchived).toBe(true);
    const unarchived = await conversations.unarchiveConversation(created.id);
    expect(unarchived.isArchived).toBe(false);
  });

  it('duplicates a conversation with its messages under a new id', async () => {
    const { conversations, messages } = await freshServices();
    const created = await conversations.createConversation('original');
    await messages.createMessage('q', MessageRole.USER, created.id);
    await messages.createMessage('a', MessageRole.ASSISTANT, created.id);

    const copy = await conversations.duplicateConversation(created.id);
    expect(copy.id).not.toBe(created.id);
    expect(copy.title).toBe('Copy of original');
    const tree = await messages.getMessageTree(copy.id);
    expect(tree.nodes.map((node) => node.content).sort()).toEqual(['a', 'q']);
  });

  it('duplicates with an explicit new title', async () => {
    const { conversations } = await freshServices();
    const created = await conversations.createConversation('original');
    const copy = await conversations.duplicateConversation(created.id, 'renamed copy');
    expect(copy.title).toBe('renamed copy');
  });

  it('refuses to duplicate a missing conversation', async () => {
    const conversations = await freshService();
    await expect(conversations.duplicateConversation('nope')).rejects.toThrow('Original conversation not found');
  });

  it('searches titles case-insensitively', async () => {
    const conversations = await freshService();
    await conversations.createConversation('Gnome release notes');
    await conversations.createConversation('unrelated');
    const hits = await conversations.searchConversations('gnome');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Gnome release notes');
  });

  it('exports and re-imports a conversation as JSON', async () => {
    const conversations = await freshService();
    const created = await conversations.createConversation('exported');
    const json = await conversations.exportConversation(created.id);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('exported');
    const imported = await conversations.importConversation(json);
    expect(imported.id).not.toBe(created.id);
    expect(imported.title).toBe('exported');
  });

  it('deletes a conversation and its rows', async () => {
    const conversations = await freshService();
    const created = await conversations.createConversation('doomed');
    await conversations.deleteConversation(created.id);
    expect(await conversations.getConversationById(created.id)).toBeNull();
    const stats = await conversations.getConversationStats();
    expect(stats.totalConversations).toBe(0);
    expect(stats.totalMessages).toBe(0);
  });

  it('clearAllConversations empties the table', async () => {
    const conversations = await freshService();
    await conversations.createConversation('one');
    await conversations.createConversation('two');
    await conversations.clearAllConversations();
    expect(await conversations.getAllConversations()).toEqual([]);
  });
});
