import { ipcMain } from 'electron';
import type { ConversationService } from '@main/services/ConversationService';
import type { ConversationMetadata } from '@shared/types';

/** Every channel this module registers (the teardown list consumes this). */
export const CONVERSATIONS_IPC_CHANNELS: string[] = [
  'db:conversations:create', 'db:conversations:get-all', 'db:conversations:get-by-id',
  'db:conversations:update', 'db:conversations:delete', 'db:conversations:set-metadata',
  'db:conversations:clear-all',
];

export interface ConversationsIpcDeps {
  conversationService: ConversationService;
}

export function registerConversationsIpc(deps: ConversationsIpcDeps): void {
  const { conversationService } = deps;

  ipcMain.handle('db:conversations:create', async (event, title: string) => {
    try {
      const conversation = await conversationService.createConversation(title);
      return conversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:get-all', async () => {
    try {
      const conversations = await conversationService.getAllConversations();
      return conversations;
    } catch (error) {
      console.error('Failed to get conversations:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:get-by-id', async (event, id: string) => {
    try {
      const conversation = await conversationService.getConversationById(id);
      return conversation;
    } catch (error) {
      console.error('Failed to get conversation by id:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:update', async (event, id: string, title: string) => {
    try {
      const conversation = await conversationService.updateConversation(id, { title });
      return conversation;
    } catch (error) {
      console.error('Failed to update conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:delete', async (event, id: string) => {
    try {
      await conversationService.deleteConversation(id);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:set-metadata', async (event, id: string, metadata: ConversationMetadata) => {
    try {
      return await conversationService.setConversationMetadata(id, metadata);
    } catch (error) {
      console.error('Failed to set conversation metadata:', error);
      throw error;
    }
  });

  ipcMain.handle('db:conversations:clear-all', async () => {
    try {
      await conversationService.clearAllConversations();
      return true;
    } catch (error) {
      console.error('Failed to clear all conversations:', error);
      throw error;
    }
  });
}
