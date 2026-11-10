import type { JSX } from 'react';
import { Copy, Eraser } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT } from '@shared/constants/text';

/**
 * Conversation-scoped actions at the foot of the history rail (plan 74):
 * clearing belongs with the conversation list, not in the title bar where it
 * sat next to window controls and read as chrome. Rename/delete stay on the
 * rows; this is the one destructive action that applies to the ACTIVE
 * conversation.
 */
export function ConversationRailFooter({
  onClear,
  onDuplicate,
  disabled = false,
}: {
  onClear: () => void;
  onDuplicate?: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 border-t border-[var(--as-border)] px-1 pt-2">
      {onDuplicate && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="duplicate-conversation"
          disabled={disabled}
          title={TEXT.CONVERSATION_DUPLICATE}
          aria-label={TEXT.CONVERSATION_DUPLICATE}
          className="justify-start text-xs opacity-70 hover:opacity-100"
          onClick={onDuplicate}
        >
          <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
          {TEXT.CONVERSATION_DUPLICATE}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="clear-conversation"
        disabled={disabled}
        title={TEXT.CLEAR_CONVERSATION_HINT}
        aria-label={TEXT.LAUNCHER_CLEAR_CONVERSATION}
        className="justify-start text-xs opacity-70 hover:text-[var(--as-destructive)] hover:opacity-100"
        onClick={onClear}
      >
        <Eraser className="mr-1 h-3.5 w-3.5" aria-hidden />
        {TEXT.CLEAR_BUTTON}
      </Button>
    </div>
  );
}
