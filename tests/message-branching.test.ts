import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { DatabaseService } = await import('@main/services/DatabaseService');
const { ConversationService } = await import('@main/services/ConversationService');
const { MessageService } = await import('@main/services/MessageService');
const { MessageRole } = await import('@shared/database-types');

describe('branching persistence + active-path walk (plan 40 S1)', () => {
  let dir: string;
  let db: InstanceType<typeof DatabaseService>;
  let conversations: InstanceType<typeof ConversationService>;
  let messages: InstanceType<typeof MessageService>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'da-branching-'));
    process.env.DESKTOP_ASSISTANT_DATA_DIR = dir;
    db = new DatabaseService();
    await db.initialize();
    conversations = new ConversationService(db);
    messages = new MessageService(db, conversations);
  });

  afterEach(async () => {
    delete process.env.DESKTOP_ASSISTANT_DATA_DIR;
    await db.cleanup();
    await rm(dir, { recursive: true, force: true });
  });

  it('chains new messages under the active tip and writes the root pointer', async () => {
    const conversation = await conversations.createConversation('Tree');
    const first = await messages.createMessage('first', MessageRole.USER, conversation.id);
    const second = await messages.createMessage('second', MessageRole.ASSISTANT, conversation.id);
    const third = await messages.createMessage('third', MessageRole.USER, conversation.id);

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
    expect(third.parentId).toBe(second.id);

    const root = await db.getClient().conversation.findUnique({ where: { id: conversation.id } });
    expect(root?.activeRootId).toBe(first.id);
    const firstRow = await db.getClient().message.findUnique({ where: { id: first.id } });
    const secondRow = await db.getClient().message.findUnique({ where: { id: second.id } });
    expect(firstRow?.activeChildId).toBe(second.id);
    expect(secondRow?.activeChildId).toBe(third.id);

    const active = await messages.getMessagesByConversation(conversation.id);
    expect(active.map((message) => message.id)).toEqual([first.id, second.id, third.id]);
    for (const message of active) {
      expect(message).toMatchObject({ variantIndex: 0, variantCount: 1, siblingIds: [message.id] });
    }
  });

  it('reads the full tree while the list stays the active path', async () => {
    const conversation = await conversations.createConversation('Tree');
    const first = await messages.createMessage('first', MessageRole.USER, conversation.id);
    const second = await messages.createMessage('second', MessageRole.ASSISTANT, conversation.id);
    const tree = await messages.getMessageTree(conversation.id);
    expect(tree.activeRootId).toBe(first.id);
    expect(tree.nodes.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(tree.nodes.map((message) => message.parentId)).toEqual([null, first.id]);
    expect((await messages.getMessagesByConversation(conversation.id)).map((message) => message.id)).toEqual([first.id, second.id]);
  });

  it('keeps the walk-length invariant across random linear create sequences', async () => {
    for (let round = 0; round < 5; round += 1) {
      const conversation = await conversations.createConversation(`Round ${round}`);
      const count = 30;
      for (let index = 0; index < count; index += 1) {
        await messages.createMessage(`m${index}`, index % 2 === 0 ? MessageRole.USER : MessageRole.ASSISTANT, conversation.id);
      }
      const active = await messages.getMessagesByConversation(conversation.id);
      expect(active).toHaveLength(count);
      const tree = await messages.getMessageTree(conversation.id);
      expect(tree.nodes).toHaveLength(count);
      const tips = tree.nodes.filter((message) => !tree.nodes.some((candidate) => candidate.parentId === message.id));
      expect(tips).toHaveLength(1);
      expect(tips[0].id).toBe(active.at(-1)?.id);
      expect(active.every((message) => message.siblingIds?.length === 1)).toBe(true);
    }
  });
});
