import { DatabaseService } from '@main/services/DatabaseService';
import { PrismaClient, Message as PrismaMessage, Conversation, Prisma } from 'generated/prisma/client';
import { MessageRole, stringToMessageRole } from '@shared/database-types';
import type { Message } from '@shared/database-types';
import { ConversationService } from '@main/services/ConversationService';
import { Attachment } from '@shared/types';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { parseAttachmentList, validateAttachmentList } from '@shared/schema/attachmentList';
import { parseTurnMetadata, validateTurnMetadata } from '@shared/schema/turnMetadata';
import { activePathRows, ancestorChain, decorateBranchRows } from './messageTree';

// Define the type for a message as returned by Prisma, including the conversation relation
type MessageWithConversation = PrismaMessage & {
  conversation?: Conversation;
};

export interface CreateMessageOptions {
  /** Explicit parent for a branch write; omitted = append under the active tip. */
  parentId?: string | null;
  /**
   * Pointer behavior: `if-tip` (default) flips only a childless parent that is
   * on the active path (`false` never flips; `always` is the regenerate case).
   */
  activate?: boolean | 'if-tip' | 'always';
}

export class MessageService {
  private db: PrismaClient;
  private conversationService: ConversationService;

  constructor(databaseService: DatabaseService, conversationService: ConversationService) {
    this.db = databaseService.getClient();
    this.conversationService = conversationService;
  }

  /**
   * Create a new message
   */
    async createMessage(
    content: string,
    role: MessageRole,
    conversationId: string,
    attachments?: Attachment[],
    error?: string,
    metadata?: TurnMetadata,
    options?: CreateMessageOptions
  ): Promise<Message> {
    try {
      // Validate conversation exists
      const conversationExists = await this.conversationService.conversationExists(conversationId);
      if (!conversationExists) {
        throw new Error('Conversation not found');
      }

      const validatedMetadata = metadata !== undefined ? validateTurnMetadata(metadata) : undefined;
      const validatedAttachments = attachments !== undefined ? validateAttachmentList(attachments) : undefined;
      const explicitParent = options !== undefined && Object.prototype.hasOwnProperty.call(options, 'parentId');
      const activate = options?.activate ?? 'if-tip';
      const message = await this.db.$transaction(async (tx) => {
        const conversation = await tx.conversation.findUnique({
          where: { id: conversationId },
          select: { activeRootId: true },
        });
        if (!conversation) {
          throw new Error('Conversation not found');
        }
        const parentId = explicitParent ? (options?.parentId ?? null) : await this.activeTip(tx, conversation.activeRootId);
        const created = await tx.message.create({
          data: {
            content: content.trim(),
            role,
            conversationId,
            createdAt: new Date(),
            error: error,
            parentId,
            metadata:
              validatedMetadata !== undefined
                ? (validatedMetadata as unknown as Prisma.InputJsonValue)
                : undefined,
            attachments:
              validatedAttachments && validatedAttachments.length > 0
                ? (validatedAttachments as unknown as Prisma.InputJsonValue)
                : undefined,
          },
          include: {
            conversation: true,
          },
        });
        if (activate !== false) {
          if (parentId === null) {
            if (activate === 'always' || conversation.activeRootId === null) {
              await tx.conversation.update({
                where: { id: conversationId },
                data: { activeRootId: created.id },
              });
            }
          } else if (await this.isOnActivePath(tx, conversationId, conversation.activeRootId, parentId)) {
            const parent = await tx.message.findUnique({
              where: { id: parentId },
              select: { activeChildId: true },
            });
            if (activate === 'always' || !parent?.activeChildId) {
              await tx.message.update({
                where: { id: parentId },
                data: { activeChildId: created.id },
              });
            }
          }
        }
        return created;
      });

      await this.conversationService.touchConversation(conversationId);

      const decorated = await this.getMessageById(message.id);
      return decorated ?? this.mapMessage(message);
    } catch (error) {
      console.error('Failed to create message:', error);
      throw new Error(`Failed to create message: ${error}`);
    }
  }


  /**
   * Get all messages for a conversation
   */
  async getMessagesByConversation(
    conversationId: string,
    limit?: number,
    offset?: number
  ): Promise<Message[]> {
    try {
      const tree = await this.getConversationTree(conversationId);
      const active = this.activePath(tree.rows, tree.decorated, tree.activeRootId);
      const start = offset ?? 0;
      return limit !== undefined ? active.slice(start, start + limit) : active.slice(start);
    } catch (error) {
      console.error('Failed to get messages by conversation:', error);
      throw new Error(`Failed to get messages: ${error}`);
    }
  }

  async getMessageTree(conversationId: string): Promise<{ activeRootId: string | null; nodes: Message[] }> {
    const tree = await this.getConversationTree(conversationId);
    return { activeRootId: tree.activeRootId, nodes: tree.decorated };
  }

  /**
   * Edit = a new user sibling under the same parent + pointer flip. The old
   * subtree is retained and switchable; the new row records `branchedFrom`.
   */
  async editMessage(
    messageId: string,
    content: string,
    attachments?: Attachment[]
  ): Promise<{ conversationId: string; message: Message }> {
    const source = await this.db.message.findUnique({ where: { id: messageId } });
    if (!source) {
      throw new Error('Message not found');
    }
    if (source.role !== MessageRole.USER) {
      throw new Error('Only user messages can be edited.');
    }
    if (!content.trim()) {
      throw new Error('Message content cannot be empty');
    }
    const inherited = attachments !== undefined ? validateAttachmentList(attachments) : parseAttachmentList(source.attachments);
    const metadata = validateTurnMetadata({ outcome: 'ok', branchedFrom: messageId });
    const edited = await this.db.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          content: content.trim(),
          role: MessageRole.USER,
          conversationId: source.conversationId,
          createdAt: new Date(),
          parentId: source.parentId,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          attachments:
            inherited && inherited.length > 0
              ? (inherited as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });
      if (source.parentId) {
        await tx.message.update({
          where: { id: source.parentId },
          data: { activeChildId: created.id },
        });
      } else {
        await tx.conversation.update({
          where: { id: source.conversationId },
          data: { activeRootId: created.id },
        });
      }
      return created;
    });
    await this.conversationService.touchConversation(source.conversationId);
    const message = await this.getMessageById(edited.id);
    return { conversationId: source.conversationId, message: message ?? this.mapMessage(edited) };
  }

  /**
   * Regenerate prepares the path to the target user message; the turn itself
   * persists the new assistant sibling under it. Returns the old active reply
   * as `branchedFrom` (or the user anchor when there was no reply yet).
   */
  async prepareRegenerate(messageId: string): Promise<{
    conversationId: string;
    message: Message;
    branchedFrom: string;
  }> {
    const target = await this.db.message.findUnique({ where: { id: messageId } });
    if (!target) {
      throw new Error('Message not found');
    }
    if (target.role !== MessageRole.USER) {
      throw new Error('Regenerate targets a user message.');
    }
    const tree = await this.getConversationTree(target.conversationId);
    const path = activePathRows(tree.rows, tree.activeRootId);
    if (!path.some((row) => row.id === target.id)) {
      const chain = ancestorChain(tree.rows, target.id);
      await this.db.$transaction(async (tx) => {
        if (chain[0]?.parentId === null) {
          await tx.conversation.update({
            where: { id: target.conversationId },
            data: { activeRootId: chain[0].id },
          });
        }
        for (let index = 0; index < chain.length - 1; index += 1) {
          await tx.message.update({
            where: { id: chain[index].id },
            data: { activeChildId: chain[index + 1].id },
          });
        }
      });
      await this.conversationService.touchConversation(target.conversationId);
    }
    const activeReply = await this.db.message.findFirst({
      where: { parentId: target.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const message = await this.getMessageById(target.id);
    return {
      conversationId: target.conversationId,
      message: message ?? this.mapMessage(target),
      branchedFrom: activeReply?.id ?? target.id,
    };
  }

  /** Select = level-flip exactly ONE pointer, then re-walk the active path. */
  async selectMessage(messageId: string): Promise<{ conversationId: string; messages: Message[] }> {
    const target = await this.db.message.findUnique({ where: { id: messageId } });
    if (!target) {
      throw new Error('Message not found');
    }
    if (target.parentId) {
      await this.db.message.update({
        where: { id: target.parentId },
        data: { activeChildId: target.id },
      });
    } else {
      await this.db.conversation.update({
        where: { id: target.conversationId },
        data: { activeRootId: target.id },
      });
    }
    await this.conversationService.touchConversation(target.conversationId);
    return {
      conversationId: target.conversationId,
      messages: await this.getMessagesByConversation(target.conversationId),
    };
  }



  /**
   * Get recent messages for a conversation
   */
  async getRecentMessages(
    conversationId: string,
    limit: number = 10
  ): Promise<Message[]> {
    try {
      const tree = await this.getConversationTree(conversationId);
      const active = this.activePath(tree.rows, tree.decorated, tree.activeRootId);
      return active.slice(-limit);
    } catch (error) {
      console.error('Failed to get recent messages:', error);
      throw new Error(`Failed to get recent messages: ${error}`);
    }
  }

  /**
   * Get message by ID
   */
  async getMessageById(id: string): Promise<Message | null> {
    try {
      const message = await this.db.message.findUnique({
        where: { id },
        include: {
          conversation: true
        }
      });

      if (!message) {
        return null;
      }

      const tree = await this.getConversationTree(message.conversationId);
      return tree.decorated.find((candidate) => candidate.id === id) ?? this.mapMessage(message);
    } catch (error) {
      console.error('Failed to get message by ID:', error);
      throw new Error(`Failed to get message: ${error}`);
    }
  }

  /**
   * Update message content
   */
  async updateMessage(
    id: string,
    data: { content?: string; role?: MessageRole; metadata?: TurnMetadata }
  ): Promise<Message> {
    try {
      const validatedMetadata = data.metadata !== undefined ? validateTurnMetadata(data.metadata) : undefined;
      const message = await this.db.message.update({
        where: { id },
        data: {
          ...data,
          ...(data.content && { content: data.content.trim() }),
          ...(validatedMetadata !== undefined
            ? { metadata: validatedMetadata as unknown as Prisma.InputJsonValue }
            : {}),
        } as never,
        include: {
          conversation: true
        }
      });

      // Update conversation timestamp
      await this.conversationService.touchConversation(message.conversationId);

      return this.mapMessage(message);
    } catch (error) {
      console.error('Failed to update message:', error);
      throw new Error(`Failed to update message: ${error}`);
    }
  }

  /**
   * Delete message
   */
  async deleteMessage(id: string): Promise<void> {
    try {
      const message = await this.db.message.findUnique({
        where: { id },
        select: { conversationId: true }
      });

      if (!message) {
        throw new Error('Message not found');
      }

      await this.db.message.delete({
        where: { id }
      });

      // Update conversation timestamp
      await this.conversationService.touchConversation(message.conversationId);

    } catch (error) {
      console.error('Failed to delete message:', error);
      throw new Error(`Failed to delete message: ${error}`);
    }
  }

  /**
   * Delete multiple messages
   */
  async deleteMessages(ids: string[]): Promise<number> {
    try {
      const result = await this.db.message.deleteMany({
        where: {
          id: {
            in: ids
          }
        }
      });

      return result.count;
    } catch (error) {
      console.error('Failed to delete messages:', error);
      throw new Error(`Failed to delete messages: ${error}`);
    }
  }

  /**
   * Clear all messages from a conversation
   */
  async clearMessagesByConversation(conversationId: string): Promise<void> {
    try {
      await this.db.message.deleteMany({
        where: {
          conversationId
        }
      });

    } catch (error) {
      console.error('Failed to clear messages by conversation:', error);
      throw new Error(`Failed to clear messages: ${error}`);
    }
  }

  /**
   * Get message count for a conversation
   */
  async getMessageCount(conversationId: string): Promise<number> {
    try {
      return await this.db.message.count({
        where: {
          conversationId
        }
      });
    } catch (error) {
      console.error('Failed to get message count:', error);
      throw new Error(`Failed to get message count: ${error}`);
    }
  }


  /**
   * Get messages by role
   */
  async getMessagesByRole(
    conversationId: string,
    role: MessageRole
  ): Promise<Message[]> {
    try {
      const messages = await this.db.message.findMany({
        where: {
          conversationId,
          role
        },
        orderBy: {
          createdAt: 'asc'
        },
        include: {
          conversation: true
        }
      });

      return messages.map((msg) => this.mapMessage(msg));
    } catch (error) {
      console.error('Failed to get messages by role:', error);
      throw new Error(`Failed to get messages by role: ${error}`);
    }
  }

  /**
   * Search messages by content
   */
  async searchMessages(
    query: string,
    conversationId?: string
  ): Promise<Message[]> {
    try {
      const messages = await this.db.message.findMany({
        where: {
          content: {
            contains: query
          },
          ...(conversationId && { conversationId })
        },
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          conversation: true
        }
      });

      return messages.map((msg) => this.mapMessage(msg));
    } catch (error) {
      console.error('Failed to search messages:', error);
      throw new Error(`Failed to search messages: ${error}`);
    }
  }

  /**
   * Get conversation context (recent messages for AI)
   */
  async getConversationContext(
    conversationId: string,
    maxMessages: number = 20
  ): Promise<Message[]> {
    try {
      const messages = await this.db.message.findMany({
        where: {
          conversationId
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: maxMessages,
        include: {
          conversation: true
        }
      });

      // Return in chronological order
      return messages.reverse().map((msg) => this.mapMessage(msg));
    } catch (error) {
      console.error('Failed to get conversation context:', error);
      throw new Error(`Failed to get conversation context: ${error}`);
    }
  }

  /**
   * Create multiple messages (batch)
   */
  async createMessages(
    messagesData: Array<{
      content: string;
      role: MessageRole;
      conversationId: string;
    }>
  ): Promise<Message[]> {
    try {
      const messages = await this.db.$transaction(
        messagesData.map(data =>
          this.db.message.create({
            data: {
              content: data.content.trim(),
              role: data.role,
              conversationId: data.conversationId,
              createdAt: new Date()
            },
            include: {
              conversation: true
            }
          })
        )
      );

      // Update conversation timestamps
      const conversationIds = [...new Set(messagesData.map(m => m.conversationId))];
      await Promise.all(
        conversationIds.map(id => this.conversationService.touchConversation(id))
      );

      return messages.map((msg) => this.mapMessage(msg));
    } catch (error) {
      console.error('Failed to create messages batch:', error);
      throw new Error(`Failed to create messages batch: ${error}`);
    }
  }

  /**
   * Get last message from conversation
   */
  async getLastMessage(conversationId: string): Promise<Message | null> {
    try {
      const message = await this.db.message.findFirst({
        where: {
          conversationId
        },
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          conversation: true
        }
      });

      if (!message) {
        return null;
      }

      return this.mapMessage(message);
    } catch (error) {
      console.error('Failed to get last message:', error);
      throw new Error(`Failed to get last message: ${error}`);
    }
  }

  /**
   * Get first message from conversation
   */
  async getFirstMessage(conversationId: string): Promise<Message | null> {
    try {
      const tree = await this.getConversationTree(conversationId);
      return this.activePath(tree.rows, tree.decorated, tree.activeRootId)[0] ?? null;
    } catch (error) {
      console.error('Failed to get first message:', error);
      throw new Error(`Failed to get first message: ${error}`);
    }
  }

  /**
   * Map database message to application type
   */

  private async getConversationTree(conversationId: string): Promise<{
    rows: PrismaMessage[];
    decorated: Message[];
    activeRootId: string | null;
  }> {
    const [conversation, rows] = await Promise.all([
      this.db.conversation.findUnique({ where: { id: conversationId }, select: { activeRootId: true } }),
      this.db.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      rows,
      decorated: this.decorate(rows),
      activeRootId: conversation?.activeRootId ?? null,
    };
  }

  private decorate(rows: PrismaMessage[]): Message[] {
    const decoration = decorateBranchRows(rows);
    return rows.map((row) => ({
      ...this.mapMessage(row as MessageWithConversation),
      ...(decoration.get(row.id) ?? {
        parentId: row.parentId,
        activeChildId: row.activeChildId,
        childIds: [],
        variantIndex: 0,
        variantCount: 1,
        siblingIds: [row.id],
      }),
    }));
  }

  private activePath(rows: PrismaMessage[], decorated: Message[], activeRootId: string | null): Message[] {
    const pathIds = new Set(activePathRows(rows, activeRootId).map((row) => row.id));
    return decorated.filter((message) => pathIds.has(message.id));
  }

  private async activeTip(
    tx: Prisma.TransactionClient,
    activeRootId: string | null
  ): Promise<string | null> {
    let current = activeRootId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = await tx.message.findUnique({
        where: { id: current },
        select: { activeChildId: true },
      });
      if (!node) {
        return null;
      }
      if (!node.activeChildId) {
        return current;
      }
      current = node.activeChildId;
    }
    return current;
  }

  private async isOnActivePath(
    tx: Prisma.TransactionClient,
    conversationId: string,
    activeRootId: string | null,
    messageId: string
  ): Promise<boolean> {
    const rows = await tx.message.findMany({
      where: { conversationId },
      select: { id: true, parentId: true, activeChildId: true, createdAt: true },
    });
    return activePathRows(rows, activeRootId).some((row) => row.id === messageId);
  }

  private mapMessage(dbMessage: MessageWithConversation): Message {
    const message: Message = {
        id: dbMessage.id,
        content: dbMessage.content,
        attachments: parseAttachmentList(dbMessage.attachments),
        metadata: parseTurnMetadata(dbMessage.metadata),
        role: stringToMessageRole(dbMessage.role),
        conversationId: dbMessage.conversationId,
        createdAt: dbMessage.createdAt,
    };

    if (dbMessage.conversation) {
        message.conversation = {
            id: dbMessage.conversation.id,
            title: dbMessage.conversation.title,
        };
    }

    return message;
  }

  /**
   * Check if message exists
   */
  async messageExists(id: string): Promise<boolean> {
    try {
      const count = await this.db.message.count({
        where: { id }
      });
      return count > 0;
    } catch (error) {
      console.error('Failed to check message existence:', error);
      return false;
    }
  }

  /**
   * Get message word count
   */
  getMessageWordCount(content: string): number {
    return content.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Get message character count
   */
  getMessageCharCount(content: string): number {
    return content.length;
  }

  /**
   * Validate message content
   */
  validateMessageContent(content: string): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if content is empty
    if (!content || content.trim().length === 0) {
      errors.push('Message content cannot be empty');
    }

    // Check content length
    if (content.length > 10000) {
      errors.push('Message content too long (max 10,000 characters)');
    }

    // Check for very long content
    if (content.length > 5000) {
      warnings.push('Message content is very long');
    }

    // Check word count
    const wordCount = this.getMessageWordCount(content);
    if (wordCount > 2000) {
      warnings.push('Message has many words, consider splitting');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}