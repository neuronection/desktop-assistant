import type { Attachment } from './types';
import type { Message } from './database-types';
import type { TurnStartResult } from './turns';

export interface MessageEditInput {
  messageId: string;
  content: string;
  /** Omitted = inherit the source message's attachments (text edit only). */
  attachments?: Attachment[];
}

export interface MessageRegenerateInput {
  /** The user message whose assistant reply is re-rolled. */
  messageId: string;
}

export interface ConversationTreeView {
  activeRootId: string | null;
  nodes: Message[];
}

export interface BranchMutationResult extends TurnStartResult {
  conversationId: string;
  /** The re-walked active path, decorated with variant metadata. */
  messages: Message[];
}

export interface BranchSelectionResult {
  conversationId: string;
  messages: Message[];
}
