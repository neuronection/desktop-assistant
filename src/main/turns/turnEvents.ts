import type { TurnEvent, TurnInterruptPayload, TurnNodeEvent, TurnPhase, TurnTraceStep } from '@shared/turns';

export type TurnEventSink = (event: TurnEvent) => void;

interface TurnEventFields {
  delta?: string;
  step?: TurnTraceStep;
  steps?: TurnTraceStep[];
  error?: string;
  model?: string;
  durationMs?: number;
  interrupt?: TurnInterruptPayload;
  node?: TurnNodeEvent;
}

export class TurnEventLog {
  private seq = 0;
  private readonly steps: TurnTraceStep[] = [];
  private readonly stepIndex = new Map<string, TurnTraceStep>();

  constructor(
    private readonly tempMessageId: string,
    private readonly conversationId: string,
    private readonly emit: TurnEventSink
  ) {}

  phase(phase: TurnPhase, fields: TurnEventFields = {}): void {
    this.emit({
      tempMessageId: this.tempMessageId,
      conversationId: this.conversationId,
      seq: ++this.seq,
      phase,
      ...fields,
    });
  }

  beginStep(step: Omit<TurnTraceStep, 'startedAt'>, startedAt: number = Date.now(), extra: TurnEventFields = {}): TurnTraceStep {
    const stored: TurnTraceStep = { ...step, startedAt };
    this.steps.push(stored);
    this.stepIndex.set(stored.id, stored);
    this.phase(stored.phase, { step: { ...stored }, ...extra });
    return stored;
  }

  endStep(stepId: string, endedAt: number = Date.now(), patch: Partial<Omit<TurnTraceStep, 'id' | 'startedAt'>> = {}): TurnTraceStep | null {
    const stored = this.stepIndex.get(stepId);
    if (!stored) {
      return null;
    }
    Object.assign(stored, patch, { endedAt });
    const snapshot: TurnTraceStep = { ...stored };
    const index = this.steps.findIndex((step) => step.id === stepId);
    if (index !== -1) {
      this.steps[index] = snapshot;
    }
    return snapshot;
  }

  allSteps(): TurnTraceStep[] {
    return this.steps.map((step) => ({ ...step }));
  }
}
