/** Wire shapes for the Memories manager (Settings → Tools). */

export interface MemoryView {
  id: string;
  content: string;
  source: 'user' | 'assistant';
  tags: string[];
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Undo payload: re-creates a deleted memory through the normal save path. */
export interface MemoryRestoreInput {
  content: string;
  source: 'user' | 'assistant';
  conversationId?: string | null;
  tags?: string[];
}
