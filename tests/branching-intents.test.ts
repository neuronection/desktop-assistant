import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssistantEvent, AssistantTurnInput } from '@main/ai/graphs/assistant';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { DatabaseService } = await import('@main/services/DatabaseService');
const { ConversationService } = await import('@main/services/ConversationService');
const { MessageService } = await import('@main/services/MessageService');
const { TurnManager } = await import('@main/turns/TurnManager');
const { MessageRole } = await import('@shared/database-types');
const { LLMProviderType } = await import('@shared/types');
type TurnManagerType = InstanceType<typeof TurnManager>;
type MessageServiceType = InstanceType<typeof MessageService>;
type ConversationServiceType = InstanceType<typeof ConversationService>;

const provider = {
  id: 'p1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'http://localhost:11434/v1',
  availableModels: [
    {
      id: 'test-model',
      name: 'Test Model',
      providerType: LLMProviderType.OPENAI,
      providerId: 'p1',
      caps: ['tools'],
    },
  ],
} as never;

const config = {
  providers: [provider],
  defaultChatModelId: 'test-model',
  taskAssignments: { chat: 'test-model' },
} as never;

function turnDeps(
  messages: MessageServiceType,
  conversations: ConversationServiceType,
  gateway: { chatStream: () => AsyncGenerator<string>; chat?: () => Promise<string> },
  extra: Record<string, unknown> = {}
) {
  return {
    conversations: {
      createConversation: (title: string) => conversations.createConversation(title),
      conversationExists: (id: string) => conversations.conversationExists(id),
      getConversationById: (id: string) => conversations.getConversationById(id),
      updateConversation: (id: string, data: { title?: string }) => conversations.updateConversation(id, data),
      setConversationMetadata: (id: string, metadata: Record<string, unknown>) =>
        conversations.setConversationMetadata(id, metadata as never),
    },
    messages,
    getConfig: () => config,
    resolveKey: async () => 'sk-test',
    gateway,
    broadcast: () => undefined,
    ...extra,
  } as never;
}

function scriptedGateway(replies: string[]) {
  let active = 0;
  let maxActive = 0;
  return {
    get maxActive() {
      return maxActive;
    },
    gateway: {
      chatStream: () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const text = replies.shift() ?? 'reply';
        return (async function* () {
          try {
            yield text;
          } finally {
            active -= 1;
          }
        })();
      },
      chat: async () => replies.shift() ?? 'reply',
    },
  };
}

async function waitIdle(manager: TurnManagerType): Promise<void> {
  await vi.waitFor(() => expect(manager.isActive()).toBe(false));
}

describe('branching intents + turn wiring (plan 40 S2)', () => {
  let dir: string;
  let db: InstanceType<typeof DatabaseService>;
  let conversations: ConversationServiceType;
  let messages: MessageServiceType;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'da-branch-intents-'));
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

  it('edit creates a new user sibling, starts a turn there, and keeps the old subtree', async () => {
    const scripted = scriptedGateway(['first reply', 'edited reply']);
    const manager = new TurnManager(turnDeps(messages, conversations, scripted.gateway));
    const conversation = await conversations.createConversation('Edit');

    await manager.start({ conversationId: conversation.id, content: 'first', modelId: 'test-model' });
    await waitIdle(manager);
    const before = await messages.getMessagesByConversation(conversation.id);
    const user = before.find((message) => message.role === MessageRole.USER)!;
    const oldReply = before.find((message) => message.role === MessageRole.ASSISTANT)!;

    const edited = await messages.editMessage(user.id, 'edited');
    const started = await manager.start({
      conversationId: conversation.id,
      content: 'edited',
      branch: { kind: 'edit', userMessageId: edited.message.id, branchedFrom: user.id },
    });
    expect(started.queued).toBe(false);
    await waitIdle(manager);

    const active = await messages.getMessagesByConversation(conversation.id);
    expect(active.map((message) => message.content)).toEqual(['edited', 'edited reply']);
    const conversationView = await conversations.getConversationById(conversation.id);
    expect(conversationView?.messages.map((message) => message.content)).toEqual(['edited', 'edited reply']);
    const tree = await messages.getMessageTree(conversation.id);
    expect(tree.nodes.map((message) => message.content)).toEqual(
      expect.arrayContaining(['first', 'first reply', 'edited', 'edited reply'])
    );
    const old = tree.nodes.find((message) => message.id === oldReply.id)!;
    const replacement = tree.nodes.find((message) => message.id === edited.message.id)!;
    expect(old.parentId).toBe(user.id);
    expect(active[1].parentId).toBe(replacement.id);
    expect(replacement.metadata?.branchedFrom).toBe(user.id);
    expect(active[1].metadata?.branchedFrom).toBe(user.id);
  });

  it('regenerate adds an assistant sibling under the target user and flips its pointer', async () => {
    const scripted = scriptedGateway(['first reply', 'regenerated reply']);
    const manager = new TurnManager(turnDeps(messages, conversations, scripted.gateway));
    const conversation = await conversations.createConversation('Regenerate');

    await manager.start({ conversationId: conversation.id, content: 'hello', modelId: 'test-model' });
    await waitIdle(manager);
    const before = await messages.getMessagesByConversation(conversation.id);
    const user = before.find((message) => message.role === MessageRole.USER)!;
    const oldReply = before.find((message) => message.role === MessageRole.ASSISTANT)!;

    const prepared = await messages.prepareRegenerate(user.id);
    await manager.start({
      conversationId: conversation.id,
      content: prepared.message.content,
      branch: { kind: 'regenerate', userMessageId: user.id, branchedFrom: prepared.branchedFrom },
    });
    await waitIdle(manager);

    const withoutConversation = await messages.getMessageTree(conversation.id);
    const replies = withoutConversation.nodes.filter((message) => message.parentId === user.id);
    expect(replies).toHaveLength(2);
    expect(replies.map((message) => message.id)).toContain(oldReply.id);
    const active = await messages.getMessagesByConversation(conversation.id);
    expect(active[1].content).toBe('regenerated reply');
    expect(active[1].metadata?.branchedFrom).toBe(oldReply.id);
    const userRow = await db.getClient().message.findUnique({ where: { id: user.id } });
    expect(userRow?.activeChildId).toBe(active[1].id);
  });

  it('feeds fitted history from the active path only, never a sibling subtree', async () => {
    const scripted = scriptedGateway(['old hidden reply', 'active reply']);
    const manager = new TurnManager(turnDeps(messages, conversations, scripted.gateway));
    const conversation = await conversations.createConversation('History');
    await manager.start({ conversationId: conversation.id, content: 'original', modelId: 'test-model' });
    await waitIdle(manager);
    const before = await messages.getMessagesByConversation(conversation.id);
    const user = before.find((message) => message.role === MessageRole.USER)!;
    const edited = await messages.editMessage(user.id, 'edited');
    await manager.start({
      conversationId: conversation.id,
      content: 'edited',
      branch: { kind: 'edit', userMessageId: edited.message.id, branchedFrom: user.id },
    });
    await waitIdle(manager);

    let history: AssistantTurnInput['history'] = [];
    const agent = {
      getToolCount: async () => 1,
      async *run(input: AssistantTurnInput): AsyncGenerator<AssistantEvent> {
        history = input.history;
        yield { type: 'final', text: 'next reply' };
      },
    };
    const next = new TurnManager(
      turnDeps(messages, conversations, { chatStream: async function* () {} } as never, { agent })
    );
    await next.start({ conversationId: conversation.id, content: 'next', modelId: 'test-model' });
    await waitIdle(next);

    const contents = history.map((message) => String(message.content));
    expect(contents).toContain('edited');
    expect(contents).toContain('active reply');
    expect(contents).not.toContain('old hidden reply');
    expect(contents).not.toContain('original');
  });

  it('select flips exactly one pointer and returns the re-walked path', async () => {
    const scripted = scriptedGateway(['first reply', 'regenerated reply']);
    const manager = new TurnManager(turnDeps(messages, conversations, scripted.gateway));
    const conversation = await conversations.createConversation('Select');

    await manager.start({ conversationId: conversation.id, content: 'hello', modelId: 'test-model' });
    await waitIdle(manager);
    const first = await messages.getMessagesByConversation(conversation.id);
    const user = first.find((message) => message.role === MessageRole.USER)!;
    const oldReply = first.find((message) => message.role === MessageRole.ASSISTANT)!;
    await messages.prepareRegenerate(user.id);
    await manager.start({
      conversationId: conversation.id,
      content: 'hello',
      branch: { kind: 'regenerate', userMessageId: user.id, branchedFrom: oldReply.id },
    });
    await waitIdle(manager);
    const treeBefore = await messages.getMessageTree(conversation.id);
    const pointersBefore = new Map(
      treeBefore.nodes.map((message) => [message.id, message.activeChildId ?? null])
    );

    const selected = await messages.selectMessage(oldReply.id);
    expect(selected.messages.map((message) => message.content)).toEqual(['hello', 'first reply']);
    const treeAfter = await messages.getMessageTree(conversation.id);
    const changed = treeAfter.nodes.filter(
      (message) => (message.activeChildId ?? null) !== pointersBefore.get(message.id)
    );
    expect(changed.map((message) => message.id)).toEqual([user.id]);
    const userRow = await db.getClient().message.findUnique({ where: { id: user.id } });
    expect(userRow?.activeChildId).toBe(oldReply.id);
  });

  it('queues a second send on the same conversation and never streams two at once', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const gateway = {
      chatStream: () => {
        calls += 1;
        const index = calls;
        active += 1;
        maxActive = Math.max(maxActive, active);
        return (async function* () {
          try {
            if (index === 1) {
              yield 'first';
              await gate;
              yield ' reply';
            } else {
              yield 'second reply';
            }
          } finally {
            active -= 1;
          }
        })();
      },
    };
    const manager = new TurnManager(turnDeps(messages, conversations, gateway));
    const conversation = await conversations.createConversation('Queue');

    const first = await manager.start({ conversationId: conversation.id, content: 'one', modelId: 'test-model' });
    expect(first.queued).toBe(false);
    const second = await manager.start({ conversationId: conversation.id, content: 'two', modelId: 'test-model' });
    expect(second.queued).toBe(true);
    release?.();
    await waitIdle(manager);

    expect(maxActive).toBe(1);
    const activeMessages = await messages.getMessagesByConversation(conversation.id);
    expect(activeMessages.map((message) => message.content)).toEqual(['one', 'first reply', 'two', 'second reply']);
  });

  it('completes an approval on the old branch while the edited branch runs fresh', async () => {
    const threadIds: string[] = [];
    const agent = {
      getToolCount: async () => 1,
      async *run(input: AssistantTurnInput): AsyncGenerator<AssistantEvent> {
        threadIds.push(input.threadId);
        if (input.resume) {
          yield { type: 'final', text: 'old branch reply' };
          return;
        }
        if (threadIds.length === 1) {
          yield {
            type: 'interrupt',
            requests: [
              {
                id: 'appr_0',
                toolName: 'risky',
                args: {},
                summary: 'Run risky',
                risk: 'state-changing',
                allowedDecisions: ['approve', 'reject'],
              },
            ],
          };
          return;
        }
        yield { type: 'final', text: 'edited branch reply' };
      },
    };
    const conversation = await conversations.createConversation('Pause');
    const events: Array<{ phase: string }> = [];
    const deleted: string[] = [];
    const deps = turnDeps(
      messages,
      conversations,
      { chatStream: async function* () {} } as never,
      {
        agent,
        broadcast: (event: { phase: string }) => events.push(event),
        checkpointer: { deleteThread: async (threadId: string) => deleted.push(threadId) },
      }
    );
    const paused = new TurnManager(deps);

    await paused.start({ conversationId: conversation.id, content: 'ask', modelId: 'test-model' });
    await vi.waitFor(() => expect(events.map((event) => event.phase)).toContain('interrupt'));
    const before = await messages.getMessagesByConversation(conversation.id);
    const user = before.find((message) => message.role === MessageRole.USER)!;
    const edited = await messages.editMessage(user.id, 'edited ask');
    const queued = await paused.start({
      conversationId: conversation.id,
      content: 'edited ask',
      branch: { kind: 'edit', userMessageId: edited.message.id, branchedFrom: user.id },
    });
    expect(queued.queued).toBe(true);

    expect(paused.resolveApproval({ decisions: [{ type: 'approve' }] })).toBe(true);
    await waitIdle(paused);

    const active = await messages.getMessagesByConversation(conversation.id);
    expect(active.map((message) => message.content)).toEqual(['edited ask', 'edited branch reply']);
    const tree = await messages.getMessageTree(conversation.id);
    const oldReply = tree.nodes.find((message) => message.content === 'old branch reply')!;
    const newReply = tree.nodes.find((message) => message.content === 'edited branch reply')!;
    expect(oldReply.parentId).toBe(user.id);
    expect(newReply.parentId).toBe(edited.message.id);
    expect(threadIds[0]).toBe(conversation.id);
    expect(threadIds.filter((id) => id === `${conversation.id}:${edited.message.id}`).length).toBeGreaterThan(0);
    expect(deleted).toContain(conversation.id);
    expect(deleted).toContain(`${conversation.id}:${edited.message.id}`);
  });
});
