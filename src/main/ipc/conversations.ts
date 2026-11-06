import type { ConversationService } from '@main/services/ConversationService';
import type { MessageService } from '@main/services/MessageService';
import type { ConversationMetadata } from '@shared/types';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface ConversationsIpcDeps {
  conversationService: ConversationService;
  messageService: MessageService;
}

export function registerConversationsIpc(deps: ConversationsIpcDeps): void {
  const { conversationService, messageService } = deps;

  register(IPC['db:conversations:create'], async (event, title: string) => {
    try {
      const conversation = await conversationService.createConversation(title);
      return conversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:get-all'], async () => {
    try {
      const conversations = await conversationService.getAllConversations();
      return conversations;
    } catch (error) {
      console.error('Failed to get conversations:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:get-by-id'], async (event, id: string) => {
    try {
      const conversation = await conversationService.getConversationById(id);
      return conversation;
    } catch (error) {
      console.error('Failed to get conversation by id:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:update'], async (event, id: string, title: string) => {
    try {
      const conversation = await conversationService.updateConversation(id, { title });
      return conversation;
    } catch (error) {
      console.error('Failed to update conversation:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:delete'], async (event, id: string) => {
    try {
      await conversationService.deleteConversation(id);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:set-metadata'], async (event, id: string, metadata: ConversationMetadata) => {
    try {
      return await conversationService.setConversationMetadata(id, metadata);
    } catch (error) {
      console.error('Failed to set conversation metadata:', error);
      throw error;
    }
  });

  register(IPC['db:conversations:clear-all'], async () => {
    try {
      await conversationService.clearAllConversations();
      return true;
    } catch (error) {
      console.error('Failed to clear all conversations:', error);
      throw error;
    }
  });

  register(IPC['conversations:tree'], async (_event, conversationId: string) => {
    return messageService.getMessageTree(conversationId);
  });
}
