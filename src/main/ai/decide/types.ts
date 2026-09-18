import type { DecisionOutcome, DecisionToolSchema } from '@shared/ai/decisions';

export interface DecisionRequest {
  input: string;
  tools: DecisionToolSchema[];
  systemPrompt?: string;
}

export type RuntimeEngineKind = Exclude<import('@shared/ai/decisions').DecisionEngineKind, 'off'>;

export interface DecisionEngine {
  readonly kind: RuntimeEngineKind;
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
}
