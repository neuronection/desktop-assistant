import type { TurnEvent, TurnInterruptPayload, TurnPhase, TurnTraceStep } from '@shared/turns';

export interface TurnTraceSnapshot {
  turnId: string | null;
  conversationId: string | null;
  phase: TurnPhase | null;
  startedAt: number | null;
  endedAt: number | null;
  text: string;
  error: string | null;
  steps: TurnTraceStep[];
  interrupt: TurnInterruptPayload | null;
}

type Listener = (snapshot: TurnTraceSnapshot) => void;

const emptySnapshot: TurnTraceSnapshot = {
  turnId: null,
  conversationId: null,
  phase: null,
  startedAt: null,
  endedAt: null,
  text: '',
  error: null,
  steps: [],
  interrupt: null,
};

export function createTurnTraceStore() {
  let snapshot: TurnTraceSnapshot = emptySnapshot;
  const listeners = new Set<Listener>();

  const notify = (): void => {
    const frozen = snapshot;
    listeners.forEach((listener) => listener(frozen));
  };

  const upsertStep = (steps: TurnTraceStep[], step: TurnTraceStep): TurnTraceStep[] => {
    const index = steps.findIndex((existing) => existing.id === step.id);
    if (index === -1) {
      return [...steps, step];
    }
    const next = steps.slice();
    next[index] = { ...next[index], ...step };
    return next;
  };

  /** A resumed replay marks the prior thinking step instead of duplicating it. */
  const mergeResumedStep = (steps: TurnTraceStep[], step: TurnTraceStep): TurnTraceStep[] => {
    if (!step.resumed || step.phase !== 'thinking') {
      return upsertStep(steps, step);
    }
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const existing = steps[index];
      if (existing.phase === 'thinking' && !existing.resumed) {
        const next = steps.slice();
        next[index] = { ...existing, resumed: true };
        return next;
      }
    }
    return upsertStep(steps, step);
  };

  return {
    handleEvent(event: TurnEvent): void {
      if (event.phase === 'queued') {
        snapshot = {
          turnId: event.tempMessageId,
          conversationId: event.conversationId,
          phase: event.phase,
          startedAt: Date.now(),
          endedAt: null,
          text: '',
          error: null,
          steps: [],
          interrupt: null,
        };
        notify();
        return;
      }
      if (snapshot.turnId !== event.tempMessageId) {
        return;
      }
      let steps = snapshot.steps;
      if (event.steps) {
        steps = event.steps.map((step) => ({ ...step }));
      } else if (event.step) {
        steps = mergeResumedStep(steps, { ...event.step });
      }
      snapshot = {
        ...snapshot,
        conversationId: event.conversationId,
        phase: event.phase,
        text: event.delta ? snapshot.text + event.delta : snapshot.text,
        error: event.error ?? snapshot.error,
        endedAt:
          event.phase === 'finished' || event.phase === 'failed' || event.phase === 'cancelled'
            ? Date.now()
            : snapshot.endedAt,
        steps,
        interrupt: event.phase === 'interrupt' ? event.interrupt ?? null : null,
      };
      notify();
    },
    /** Optimistic local close after this window resolved the approval. */
    clearInterrupt(): void {
      if (!snapshot.interrupt) {
        return;
      }
      snapshot = { ...snapshot, interrupt: null };
      notify();
    },
    reset(): void {
      snapshot = emptySnapshot;
      notify();
    },
    getSnapshot(): TurnTraceSnapshot {
      return snapshot;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type TurnTraceStore = ReturnType<typeof createTurnTraceStore>;
