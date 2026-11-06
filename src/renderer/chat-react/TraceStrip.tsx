import type { JSX } from 'react';
import { ChatTurnStatus } from '@neuronection/assistant-ui/chat-turn-status';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TurnPhase, TurnTraceStep } from '@shared/turns';
import { formatStepDuration, phaseLabel } from './launcherState';
import { TEXT, pluralize } from '@shared/constants/text';

export interface TraceStripProps {
  phase: TurnPhase | null;
  startedAt: number | null;
  steps: TurnTraceStep[];
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}

/** One-line live turn summary for the launcher meta row. Step detail stays
 * collapsed behind the count so step labels never wrap the chrome. */
export function TraceStrip({
  phase,
  startedAt,
  steps,
  expanded,
  onToggle,
  className,
}: TraceStripProps): JSX.Element {
  const latestTool = [...steps].reverse().find((step) => step.phase === 'tool_call' || step.phase === 'tool_result');

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className ?? ''}`}>
      <ChatTurnStatus label={phaseLabel(phase, steps)} startedAt={startedAt ?? undefined} variant="row" />
      {latestTool && (
        <span className="min-w-0 truncate text-[10px] opacity-70">
          {latestTool.label}
          {latestTool.endedAt !== undefined
            ? ` ${formatStepDuration(latestTool.startedAt, latestTool.endedAt)}`
            : ` ${TEXT.TRACE_RUNNING}`}
          {latestTool.resumed ? ` · ${TEXT.TRACE_RESUMED}` : ''}
        </span>
      )}
      {steps.length > 0 && (
        <button
          type="button"
          className="flex shrink-0 items-center gap-0.5 rounded px-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--as-focus-ring)]"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
          {steps.length} {pluralize(steps.length, TEXT.TRACE_STEP, TEXT.TRACE_STEPS)}
        </button>
      )}
    </div>
  );
}
