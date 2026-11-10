import { useCallback } from 'react';
import type { ConversationManager } from '@renderer/managers/ConversationManager';
import { NotificationService } from '@renderer/services/NotificationService';
import { TEXT } from '@shared/constants/text';
import { exportConversationTranscript } from './exportConversation';

export interface ConversationActionsDeps {
  manager: ConversationManager;
  /** The live active id (adopted from turns) — the manager's copy can lag behind a temp conversation. */
  activeId: string | null;
  conversations: { id: string; title: string }[];
  messages: { role: string; content: string; createdAt?: unknown }[];
  selectSession: (id: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

/**
 * Conversation-level actions shared by the history rail, the inspector and the
 * palette commands (plan 78 phase 4): rename in place, duplicate into a new
 * conversation and export the transcript. State ownership stays in
 * `useChatSession`; this hook only performs the operations.
 */
export function useConversationActions(deps: ConversationActionsDeps): {
  renameConversation: (id: string, title: string) => Promise<void>;
  duplicateConversation: (id?: string) => Promise<void>;
  exportConversation: (id?: string, format?: 'md' | 'json') => Promise<void>;
} {
  const { manager, activeId, conversations, messages, selectSession, refreshConversations } = deps;

  const renameConversation = useCallback(
    async (id: string, title: string): Promise<void> => {
      const clean = title.trim();
      if (clean.length === 0 || id.startsWith('temp-')) {
        return;
      }
      await window.electronAPI.updateConversation(id, clean).catch(() => undefined);
      await refreshConversations();
    },
    [refreshConversations]
  );

  const duplicateConversation = useCallback(
    async (id?: string): Promise<void> => {
      const targetId = id ?? activeId ?? manager.getActiveConversation()?.id ?? null;
      if (targetId === null || targetId.startsWith('temp-')) {
        return;
      }
      const copy = await window.electronAPI.duplicateConversation(targetId).catch(() => null);
      if (copy === null || typeof copy.id !== 'string') {
        NotificationService.showError(TEXT.CONVERSATION_DUPLICATE_FAILED);
        return;
      }
      await selectSession(copy.id);
      await refreshConversations();
      NotificationService.showSuccess(TEXT.CONVERSATION_DUPLICATED);
    },
    [activeId, manager, refreshConversations, selectSession]
  );

  const exportConversation = useCallback(
    async (id?: string, format: 'md' | 'json' = 'md'): Promise<void> => {
      const active = manager.getActiveConversation();
      const targetId = id ?? active?.id ?? null;
      const title =
        id === undefined || id === active?.id
          ? (active?.title ?? TEXT.DESKTOP_EXPORT_FALLBACK_TITLE)
          : (conversations.find((conversation) => conversation.id === id)?.title ?? TEXT.DESKTOP_EXPORT_FALLBACK_TITLE);
      await exportConversationTranscript({
        id: targetId,
        title,
        format,
        ...(targetId !== null && targetId === active?.id ? { messages } : {}),
      });
    },
    [conversations, manager, messages]
  );

  return { renameConversation, duplicateConversation, exportConversation };
}
