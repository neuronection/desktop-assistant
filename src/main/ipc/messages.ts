import { MessageCreate, stringToMessageRole } from '@shared/database-types';
import type { MessageEditInput, MessageRegenerateInput } from '@shared/branching';
import type { MessageService } from '@main/services/MessageService';
import type { TurnManager } from '@main/turns/TurnManager';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface MessagesIpcDeps {
  messageService: MessageService;
  turnManager: TurnManager;
}

export function registerMessagesIpc(deps: MessagesIpcDeps): void {
  const { messageService, turnManager } = deps;

  register(IPC['db:messages:create'], async (event, messageData: MessageCreate) => {
    try {
      const message = await messageService.createMessage(
        messageData.content,
        stringToMessageRole(messageData.role),
        messageData.conversationId,
        messageData.attachments,
        messageData.error
      );
      return message;
    } catch (error) {
      console.error('Failed to create message:', error);
      throw error;
    }
  });

  register(IPC['db:messages:get-by-conversation'], async (event, conversationId: string) => {
    try {
      const messages = await messageService.getMessagesByConversation(conversationId);
      return messages;
    } catch (error) {
      console.error('Failed to get messages by conversation:', error);
      throw error;
    }
  });

  register(IPC['db:messages:update'], async (event, id: string, content: string) => {
    try {
      const message = await messageService.updateMessage(id, { content });
      return message;
    } catch (error) {
      console.error('Failed to update message:', error);
      throw error;
    }
  });

  register(IPC['db:messages:delete'], async (event, id: string) => {
    try {
      await messageService.deleteMessage(id);
      return true;
    } catch (error) {
      console.error('Failed to delete message:', error);
      throw error;
    }
  });

  register(IPC['db:messages:clear-by-conversation'], async (event, conversationId: string) => {
    try {
      await messageService.clearMessagesByConversation(conversationId);
      return true;
    } catch (error) {
      console.error('Failed to clear messages by conversation:', error);
      throw error;
    }
  });

  register(IPC['messages:edit'], async (_event, input: MessageEditInput) => {
    const edited = await messageService.editMessage(input.messageId, input.content, input.attachments);
    const started = await turnManager.start({
      conversationId: edited.conversationId,
      content: input.content,
      ...(edited.message.attachments?.length ? { attachments: edited.message.attachments } : {}),
      branch: {
        kind: 'edit',
        userMessageId: edited.message.id,
        branchedFrom: input.messageId,
      },
    });
    return {
      conversationId: edited.conversationId,
      messages: await messageService.getMessagesByConversation(edited.conversationId),
      ...started,
    };
  });

  register(IPC['messages:regenerate'], async (_event, input: MessageRegenerateInput) => {
    const prepared = await messageService.prepareRegenerate(input.messageId);
    const started = await turnManager.start({
      conversationId: prepared.conversationId,
      content: prepared.message.content,
      ...(prepared.message.attachments?.length ? { attachments: prepared.message.attachments } : {}),
      branch: {
        kind: 'regenerate',
        userMessageId: prepared.message.id,
        branchedFrom: prepared.branchedFrom,
      },
    });
    return {
      conversationId: prepared.conversationId,
      messages: await messageService.getMessagesByConversation(prepared.conversationId),
      ...started,
    };
  });

  register(IPC['messages:select'], async (_event, messageId: string) => {
    return messageService.selectMessage(messageId);
  });
}
