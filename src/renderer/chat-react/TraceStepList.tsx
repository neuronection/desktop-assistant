import type { JSX } from 'react';
import type { TurnTraceStep } from '@shared/turns';
import { formatStepDuration } from './launcherState';
import { TEXT } from '@shared/constants/text';

export interface TraceStepListProps {
  steps: TurnTraceStep[];
  className?: string;
}

export function TraceStepList({ steps, className }: TraceStepListProps): JSX.Element {
  return (
    <ol className={`flex flex-col gap-0.5 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] px-2 py-1 ${className ?? ''}`}>
      {steps.map((step) => (
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
  );
}
