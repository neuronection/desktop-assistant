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
  messages: InstanceType<typeof MessageService>;
  conversations: InstanceType<typeof ConversationService>;
  conversationId: string;
}> {
  dir = await mkdtemp(path.join(tmpdir(), 'da-message-service-'));
  process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
  const database = new DatabaseService();
  await database.initialize();
  const conversations = new ConversationService(database);
  const messages = new MessageService(database, conversations);
  const conversation = await conversations.createConversation('suite');
  return { messages, conversations, conversationId: conversation.id };
}

describe('MessageService (plan 46 S2)', () => {
  it('creates, reads and counts messages for a conversation', async () => {
    const { messages, conversationId } = await freshServices();
    const first = await messages.createMessage('hello', MessageRole.USER, conversationId);
    const second = await messages.createMessage('hi there', MessageRole.ASSISTANT, conversationId);
    expect(first.role).toBe(MessageRole.USER);
    expect(second.parentId).toBe(first.id);
    const rows = await messages.getMessagesByConversation(conversationId);
    expect(rows.map((row: { id: string }) => row.id)).toEqual([first.id, second.id]);
    expect(await messages.getMessageCount(conversationId)).toBe(2);
    expect(await messages.messageExists(first.id)).toBe(true);
  });

  it('round-trips the metadata envelope verbatim', async () => {
    const { messages, conversationId } = await freshServices();
    const metadata = {
      outcome: 'ok',
      startedAt: 12,
      steps: [
        { id: 's1', phase: 'thinking', label: 'Thinking', startedAt: 12, endedAt: 20, status: 'ok' },
        { id: 's2', phase: 'tool_call', label: 'Web search', toolName: 'web_search', startedAt: 20, status: 'ok', summary: '2 hits' },
      ],
      artifacts: [{ path: '/tmp/a.txt', name: 'a.txt', kind: 'file' }],
    };
    const created = await messages.createMessage('with envelope', MessageRole.ASSISTANT, conversationId, undefined, undefined, metadata as never);
    const reread = await messages.getMessageById(created.id);
    expect(reread?.metadata).toEqual(metadata);
  });

  it('rejects a message for a missing conversation', async () => {
    const { messages } = await freshServices();
    await expect(messages.createMessage('x', MessageRole.USER, 'nope')).rejects.toThrow('Conversation not found');
  });

  it('editMessage branches: the source row stays, the new row carries branchedFrom, the parent pointer flips', async () => {
    const { messages, conversationId } = await freshServices();
    const user = await messages.createMessage('original question', MessageRole.USER, conversationId);
    await messages.createMessage('original answer', MessageRole.ASSISTANT, conversationId);

    const { message: edited } = await messages.editMessage(user.id, 'edited question');
    expect(edited.parentId).toBe(user.parentId);
    expect(edited.metadata).toMatchObject({ branchedFrom: user.id });

    const oldRow = await messages.getMessageById(user.id);
    expect(oldRow).not.toBeNull();

    const tree = await messages.getMessageTree(conversationId);
    expect(tree.nodes.map((node: { id: string }) => node.id)).toEqual(expect.arrayContaining([user.id, edited.id]));
    expect(tree.activeRootId).toBe(edited.id);
  });

  it('editMessage refuses assistant rows and empty content', async () => {
    const { messages, conversationId } = await freshServices();
    const user = await messages.createMessage('q', MessageRole.USER, conversationId);
    const assistant = await messages.createMessage('a', MessageRole.ASSISTANT, conversationId);
    await expect(messages.editMessage(assistant.id, 'nope')).rejects.toThrow('Only user messages');
    await expect(messages.editMessage(user.id, '   ')).rejects.toThrow('Message content cannot be empty');
  });

  it('selectMessage switches the active path to the chosen branch', async () => {
    const { messages, conversationId } = await freshServices();
    const user = await messages.createMessage('q1', MessageRole.USER, conversationId);
    await messages.createMessage('a1', MessageRole.ASSISTANT, conversationId);
    const { message: edited } = await messages.editMessage(user.id, 'q1 edited');
    const before = await messages.getMessagesByConversation(conversationId);
    expect(before.some((row: { id: string }) => row.id === edited.id)).toBe(true);

    await messages.selectMessage(user.id);
    const after = await messages.getMessagesByConversation(conversationId);
    expect(after.some((row: { id: string }) => row.id === edited.id)).toBe(false);
    expect(after.some((row: { id: string }) => row.id === user.id)).toBe(true);
  });

  it('clearMessagesByConversation wipes the conversation rows', async () => {
    const { messages, conversationId } = await freshServices();
    await messages.createMessage('one', MessageRole.USER, conversationId);
    await messages.createMessage('two', MessageRole.ASSISTANT, conversationId);
    await messages.clearMessagesByConversation(conversationId);
    expect(await messages.getMessageCount(conversationId)).toBe(0);
    expect(await messages.getLastMessage(conversationId)).toBeNull();
  });

  it('deleteMessages removes exactly the given rows and returns the count', async () => {
    const { messages, conversationId } = await freshServices();
    const a = await messages.createMessage('a', MessageRole.USER, conversationId);
    const b = await messages.createMessage('b', MessageRole.ASSISTANT, conversationId);
    const c = await messages.createMessage('c', MessageRole.USER, conversationId);
    const removed = await messages.deleteMessages([a.id, b.id]);
    expect(removed).toBe(2);
    expect(await messages.messageExists(c.id)).toBe(true);
  });

  it('searchMessages finds rows by content substring', async () => {
    const { messages, conversationId } = await freshServices();
    await messages.createMessage('the quick brown fox', MessageRole.USER, conversationId);
    await messages.createMessage('sleeps soundly', MessageRole.ASSISTANT, conversationId);
    const hits = await messages.searchMessages('quick');
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toContain('quick');
  });
});
