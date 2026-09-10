// src/renderer/managers/ConversationManager.ts
import { Attachment, Conversation, Message, MessageRole } from '@shared/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Manages the state of conversations in the renderer process.
 * Acts as the single source of truth for the active conversation.
 */
export class ConversationManager {
  private activeConversation: Conversation | null = null;
  private static instance: ConversationManager;

  // Singleton pattern to ensure only one manager instance
  public static getInstance(): ConversationManager {
    if (!ConversationManager.instance) {
      ConversationManager.instance = new ConversationManager();
    }
    return ConversationManager.instance;
  }

  /**
   * Loads a conversation from the database or creates a new temporary one in memory.
   */
  public async loadOrCreateConversation(conversationId?: string): Promise<Conversation> {
    if (conversationId) {
      const conversation = await window.electronAPI.getConversationById(conversationId);
      if (conversation) {
        this.activeConversation = conversation;
        return conversation;
      }
    }
    
    // If no ID or conversation not found, create a new temporary one
    return this.createNewConversation();
  }

  /**
   * Creates a new, temporary conversation in-memory without saving it to the database.
   * It is only saved when the first message is added.
   * @returns The new temporary conversation object.
   */
  public createNewConversation(): Conversation {
    const tempId = `temp-${uuidv4()}`;
    const newConversation: Conversation = {
      id: tempId,
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isArchived: false,
    };
    
    this.activeConversation = newConversation;
    return newConversation;
  }

  // Loads a conversation and sets it as active
  public async loadAndSetActiveConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = await window.electronAPI.getConversationById(conversationId);
    if (conversation) {
        this.activeConversation = conversation;
    }
    return conversation;
  }

  public async getAllConversations(): Promise<Conversation[]> {
    return await window.electronAPI.getAllConversations();
  }
  
  public async deleteConversation(conversationId: string): Promise<void> {
    await window.electronAPI.deleteConversation(conversationId);
    if (this.activeConversation?.id === conversationId) {
        this.createNewConversation();
    }
  }
  public async clearAllConversations(): Promise<void> {
    await window.electronAPI.clearAllConversations();
    this.createNewConversation();
  }
  /**
   * Returns the currently active conversation.
   */
  public getActiveConversation(): Conversation | null {
    return this.activeConversation;
  }

  /**
   * Returns the messages of the active conversation.
   */
  public getActiveMessages(): Message[] {
    return this.activeConversation?.messages || [];
  }

  /**
   * Appends an in-memory message to the active conversation without
   * persisting it. Used for optimistic rendering while the main-process
   * turn owns persistence; the transcript is reconciled from the database
   * when the turn finishes.
   */
  public appendLocalMessage(content: string, role: MessageRole, attachments?: Attachment[]): Message {
    if (!this.activeConversation) {
      throw new Error('No active conversation to append a message to.');
    }
    const message: Message = {
      id: `local-${uuidv4()}`,
      content,
      role,
      attachments,
      conversationId: this.activeConversation.id,
      createdAt: new Date(),
    };
    this.activeConversation.messages.push(message);
    return message;
  }

  public removeLocalMessage(id: string): void {
    if (!this.activeConversation) {
      return;
    }
    this.activeConversation.messages = this.activeConversation.messages.filter((m) => m.id !== id);
  }

  /**
   * Clears all messages from the current conversation in the UI and database.
   */
  public async clearActiveConversationMessages(): Promise<void> {
    if (!this.activeConversation) return;

    if (this.activeConversation.id.startsWith('temp-')) {
        this.activeConversation.messages = [];
        return;
    }

    await window.electronAPI.clearMessagesByConversation(this.activeConversation.id);

    this.activeConversation.messages = [];
  }
}