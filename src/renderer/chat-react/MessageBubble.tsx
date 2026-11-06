import { useState, type JSX, type ReactNode } from 'react';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import type { ChatMessageView } from '@neuronection/assistant-ui/chat-core';
import { TEXT, interpolate } from '@shared/constants/text';

export interface MessageBubbleProps {
  message: ChatMessageView;
  compact?: boolean;
  /** App-specific body (run cards); defaults to the message markdown. */
  content?: ReactNode;
  attachments?: ReactNode;
  children?: ReactNode;
  onEdit?: (messageId: string, content: string) => void;
  onRegenerate?: (userMessageId: string) => void;
  onSelectVariant?: (messageId: string) => void;
}

/**
 * Composes the library ChatMessage with the app's edit/regenerate/select
 * intents. State stays here; persistence and turn dispatch stay in
 * useChatSession/main.
 */
export function MessageBubble({
  message,
  compact,
  content,
  attachments,
  children,
  onEdit,
  onRegenerate,
  onSelectVariant,
}: MessageBubbleProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isUser = message.role === 'user';
  const startEdit = (): void => {
    setDraft(message.content);
    setEditing(true);
  };
  const submitEdit = (): void => {
    const content = draft.trim();
    if (content && onEdit) {
      onEdit(message.id, content);
    }
    setEditing(false);
  };

  return (
    <ChatMessage
      role={message.role}
      content={content ?? message.content}
      status={message.status}
      compact={compact}
      attachments={attachments}
      variants={message.variants}
      onSelectVariant={onSelectVariant}
      editing={
        editing
          ? {
              value: draft,
              onValueChange: setDraft,
              onSubmit: submitEdit,
              onCancel: () => setEditing(false),
              submitDisabled: draft.trim().length === 0,
            }
          : false
      }
      actions={{
        onEdit: isUser && onEdit ? startEdit : undefined,
        onRegenerate:
          !isUser && onRegenerate && message.parentId ? () => onRegenerate(message.parentId as string) : undefined,
      }}
      labels={{
        edit: TEXT.CHAT_EDIT_MESSAGE,
        regenerate: TEXT.CHAT_REGENERATE,
        save: TEXT.CHAT_SAVE_RESEND,
        cancel: TEXT.CHAT_CANCEL_EDIT,
        ariaLabel: TEXT.CHAT_EDIT_MESSAGE,
        variantOf: (index, count) => interpolate(TEXT.CHAT_VARIANT_OF, { index, count }),
        previous: TEXT.CHAT_PREVIOUS_VARIANT,
        next: TEXT.CHAT_NEXT_VARIANT,
      }}
    >
      {children}
    </ChatMessage>
  );
}
