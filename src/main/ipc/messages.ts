import { ipcMain } from 'electron';
import { MessageCreate, stringToMessageRole } from '@shared/database-types';
import type { MessageService } from '@main/services/MessageService';

/** Every channel this module registers (the teardown list consumes this). */
export const MESSAGES_IPC_CHANNELS: string[] = [
  'db:messages:create', 'db:messages:get-by-conversation', 'db:messages:update',
  'db:messages:delete', 'db:messages:clear-by-conversation',
];

export interface MessagesIpcDeps {
  messageService: MessageService;
}

export function registerMessagesIpc(deps: MessagesIpcDeps): void {
  const { messageService } = deps;

  ipcMain.handle('db:messages:create', async (event, messageData: MessageCreate) => {
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

  ipcMain.handle('db:messages:get-by-conversation', async (event, conversationId: string) => {
    try {
      const messages = await messageService.getMessagesByConversation(conversationId);
      return messages;
    } catch (error) {
      console.error('Failed to get messages by conversation:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:update', async (event, id: string, content: string) => {
    try {
      const message = await messageService.updateMessage(id, { content });
      return message;
    } catch (error) {
      console.error('Failed to update message:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:delete', async (event, id: string) => {
    try {
      await messageService.deleteMessage(id);
      return true;
    } catch (error) {
      console.error('Failed to delete message:', error);
      throw error;
    }
  });

  ipcMain.handle('db:messages:clear-by-conversation', async (event, conversationId: string) => {
    try {
      await messageService.clearMessagesByConversation(conversationId);
      return true;
    } catch (error) {
      console.error('Failed to clear messages by conversation:', error);
      throw error;
    }
  });
}
