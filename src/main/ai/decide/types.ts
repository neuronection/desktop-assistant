import type { DecisionOutcome, DecisionQuestion, DecisionToolSchema } from '@shared/ai/decisions';

export interface DecisionRequest {
  input: string;
  tools: DecisionToolSchema[];
  /** Typed-question request (plan 24 D4); mutually exclusive with tool dispatch. */
  questions?: DecisionQuestion[];
  systemPrompt?: string;
}

export type RuntimeEngineKind = import('@shared/ai/decisions').DecisionEngineKind;

export interface DecisionEngine {
  readonly kind: RuntimeEngineKind;
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
}
