import { useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { ChatTurnStatus } from '@neuronection/assistant-ui/chat-turn-status';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TurnPhase, TurnTraceStep } from '@shared/turns';
import { formatStepDuration, phaseLabel } from './launcherState';
import { TEXT, pluralize } from '@shared/constants/text';

export interface TraceStripProps {
  phase: TurnPhase | null;
  startedAt: number | null;
  steps: TurnTraceStep[];
  className?: string;
}

export function TraceStrip(props: TraceStripProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const toolSteps = props.steps.filter((step) => step.phase === 'tool_call' || step.phase === 'tool_result');
  const visible = toolSteps.slice(-4);

  return (
    <div
      className={`flex min-h-7 flex-col gap-1 px-1 pb-0.5 text-xs text-[var(--as-muted-fg)] ${props.className ?? ''}`}
    >
      <div className="flex items-center gap-2">
        <ChatTurnStatus
          label={phaseLabel(props.phase, props.steps)}
          startedAt={props.startedAt ?? undefined}
          variant="row"
        />
        <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {visible.map((step) => (
            <Badge key={step.id} variant="outline" className="shrink-0 whitespace-nowrap text-[10px] font-normal">
              {step.label}
              {step.endedAt !== undefined ? ` ${formatStepDuration(step.startedAt, step.endedAt)}` : ` ${TEXT.TRACE_RUNNING}`}
              {step.resumed ? ` · ${TEXT.TRACE_RESUMED}` : ''}
            </Badge>
          ))}
          {props.steps.length > 0 && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-0.5 rounded px-1 opacity-70 transition-opacity hover:opacity-100"
              aria-expanded={showAll}
              onClick={() => setShowAll((open) => !open)}
            >
              {showAll ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
              {props.steps.length} {pluralize(props.steps.length, TEXT.TRACE_STEP, TEXT.TRACE_STEPS)}
            </button>
          )}
        </div>
      </div>
      {showAll && (
        <ol className="flex flex-col gap-0.5 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-1">
          {props.steps.map((step) => (
            <li key={step.id} className="flex items-baseline gap-2">
              <span className="w-12 shrink-0 text-right tabular-nums opacity-70">
                {step.endedAt !== undefined ? formatStepDuration(step.startedAt, step.endedAt) : '…'}
              </span>
              <span className="truncate text-[var(--as-fg)] opacity-90">
                {step.label}
                {step.resumed && (
                  <span className="ml-1 rounded-full border border-[var(--as-border)] px-1 py-px text-[9px] uppercase tracking-wide opacity-70">
                    {TEXT.TRACE_RESUMED}
                  </span>
                )}
              </span>
              {step.summary && <span className="truncate opacity-60">— {step.summary}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
