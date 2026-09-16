/** Wire shapes for the Memories manager (Settings → Tools). */

/** Provenance for a merged memory (plan 16 D9): the rows it absorbed. */
export interface MemoryMergedFrom {
  id: string;
  content: string;
  source: 'user' | 'assistant';
  mergedAt: string;
}

export interface MemoryView {
  id: string;
  content: string;
  source: 'user' | 'assistant';
  tags: string[];
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
  mergedFrom?: MemoryMergedFrom[];
}

/** Undo payload: re-creates a deleted memory through the normal save path. */
export interface MemoryRestoreInput {
  content: string;
  source: 'user' | 'assistant';
  conversationId?: string | null;
  tags?: string[];
}
