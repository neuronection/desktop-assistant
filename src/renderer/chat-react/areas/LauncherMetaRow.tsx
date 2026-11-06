import { useEffect, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { MessagesSquare, Plus } from 'lucide-react';
import type { TurnPhase, TurnTraceStep } from '@shared/turns';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { TEXT, pluralize } from '@shared/constants/text';
import { TraceStrip } from '../TraceStrip';
import { TraceStepList } from '../TraceStepList';
import { ExpandableTraceMeta } from '../TraceTimeline';

export interface LauncherMetaRowProps {
  messageCount: number;
  live: boolean;
  phase: TurnPhase | null;
  startedAt: number | null;
  steps: TurnTraceStep[];
  doneMeta: TurnMetadata | undefined;
  onToggleExpand: () => void;
  onNewConversation: () => void;
}

/** The persistent line above the composer: message count on the left, the
 * live turn summary or completed trace meta on the right. It is present in
 * every state so streaming→done never adds or removes a chrome row. */
export function LauncherMetaRow({
  messageCount,
  live,
  phase,
  startedAt,
  steps,
  doneMeta,
  onToggleExpand,
  onNewConversation,
}: LauncherMetaRowProps): JSX.Element {
  const [stepsOpen, setStepsOpen] = useState(false);

  useEffect(() => {
    if (!live) {
      setStepsOpen(false);
    }
  }, [live]);

  return (
    <div
      data-launcher-meta-row
      data-status-mode={live ? 'live' : doneMeta ? 'done' : 'idle'}
      className="flex flex-col gap-1 px-1 text-[11px] text-[var(--as-muted-foreground)]"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <button
          type="button"
          className="-mx-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors duration-100 hover:bg-[var(--as-secondary)] hover:text-[var(--as-fg)] focus-visible:outline-2 focus-visible:outline-[var(--as-focus-ring)]"
          title={TEXT.LAUNCHER_CONTEXT_EXPAND}
          aria-label={TEXT.LAUNCHER_CONTEXT_EXPAND}
          onClick={onToggleExpand}
        >
          <MessagesSquare className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          <span className="truncate">
            {messageCount > 0
              ? `${messageCount} ${pluralize(messageCount, TEXT.LAUNCHER_CHAT_MESSAGE, TEXT.LAUNCHER_CHAT_MESSAGES)}`
              : TEXT.LAUNCHER_CHAT_NEW}
          </span>
        </button>
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {live ? (
            <TraceStrip
              phase={phase}
              startedAt={startedAt}
              steps={steps}
              expanded={stepsOpen}
              onToggle={() => setStepsOpen((open) => !open)}
            />
          ) : doneMeta ? (
            <ExpandableTraceMeta meta={doneMeta} className="min-w-0" />
          ) : null}
          {messageCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              title={TEXT.MENU_NEW_CONVERSATION}
              aria-label={TEXT.MENU_NEW_CONVERSATION}
              onClick={onNewConversation}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {live && stepsOpen && steps.length > 0 && <TraceStepList steps={steps} />}
    </div>
  );
}
