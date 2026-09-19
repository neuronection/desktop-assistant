import type { JSX, ReactNode } from 'react';
import { FlowStatusCard, type FlowStep, type FlowStepStatus } from '@neuronection/assistant-ui/flow-status';
import type { TurnMetadata, TurnPhase, TurnTraceStep } from '@shared/turns';
import { TEXT } from '@shared/constants/text';

const ACTIVE_PHASES: ReadonlySet<TurnPhase> = new Set<TurnPhase>([
  'thinking',
  'tool_call',
  'tool_result',
  'streaming',
  'interrupt',
  'failed',
]);

function hasTraceableSteps(steps: TurnTraceStep[]): boolean {
  return steps.some(
    (step) =>
      step.phase === 'tool_call' || step.phase === 'tool_result' || step.id.startsWith('decision_')
  );
}

export function hasFlowTimeline(phase: TurnPhase | null, steps: TurnTraceStep[]): boolean {
  return phase !== null && ACTIVE_PHASES.has(phase) && hasTraceableSteps(steps);
}

function stepStatus(step: TurnTraceStep): FlowStepStatus {
  if (step.endedAt === undefined) {
    return 'running';
  }
  return step.phase === 'tool_call' && step.status === 'error' ? 'failed' : 'done';
}

export interface FlowCardProps {
  phase: TurnPhase | null;
  steps: TurnTraceStep[];
  error?: string | null;
  onCancel?: () => void;
  detail?: ReactNode;
  className?: string;
}

export function FlowCard({ phase, steps, error, onCancel, detail, className }: FlowCardProps): JSX.Element | null {
  if (!hasFlowTimeline(phase, steps)) {
    return null;
  }
  const status: FlowStepStatus =
    phase === 'interrupt' ? 'interrupted' : phase === 'failed' ? 'failed' : 'running';
  const flowSteps: FlowStep[] = steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: stepStatus(step),
  }));
  return (
    <FlowStatusCard
      title={TEXT.DESKTOP_FLOW_TITLE}
      steps={flowSteps}
      status={status}
      error={
        phase === 'failed'
          ? { code: 'turn_failed', message: error ?? TEXT.LAUNCHER_TURN_FAILED, retryable: false }
          : undefined
      }
      onCancel={onCancel}
      labels={{ cancel: TEXT.CANCEL_BUTTON }}
      detail={detail}
      className={className}
    />
  );
}

const FLOW_DONE_TITLE = 'Turn trace';

/**
 * Persisted trace card for a finished turn (plan 20 S6): rendered from
 * message metadata so the run's steps — decision, tools, durations —
 * stay visible after completion instead of vanishing with the live
 * card. Renders only when the turn did real work (tools/decision).
 */
export function CompletedFlowCard({ meta, className }: { meta?: TurnMetadata; className?: string }): JSX.Element | null {
  const steps = meta?.steps ?? [];
  if (!hasTraceableSteps(steps)) {
    return null;
  }
  const flowSteps: FlowStep[] = steps.map((step) => ({
    id: step.id,
    label: step.label,
    status: stepStatus(step),
  }));
  const failed = meta?.outcome === 'failed';
  return (
    <FlowStatusCard
      title={FLOW_DONE_TITLE}
      steps={flowSteps}
      status={failed ? 'failed' : 'done'}
      error={failed ? { code: 'turn_failed', message: TEXT.LAUNCHER_TURN_FAILED, retryable: false } : undefined}
      className={className}
    />
  );
}
