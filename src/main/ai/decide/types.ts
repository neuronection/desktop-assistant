import type { DecisionOutcome, DecisionQuestion, DecisionTransport, DecisionToolSchema } from '@shared/ai/decisions';

export interface DecisionRequest {
  input: string;
  tools: DecisionToolSchema[];
  /** Typed-question request (plan 24 D4); mutually exclusive with tool dispatch. */
  questions?: DecisionQuestion[];
  systemPrompt?: string;
  /** Catalog ids per app (plan 24 S4b) grounding entity args as a Choice. */
  catalogEntities?: ReadonlyMap<string, readonly string[]>;
}

export interface DecisionEngine {
  readonly transport: DecisionTransport;
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
}
