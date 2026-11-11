export interface ModelPricing {
  /** Exact model id (or resolved model id) as the provider reports it. */
  model: string;
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

export interface UsageSettings {
  pricing: ModelPricing[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Cost in USD, or null when the model has no configured price. */
export function estimateCost(usage: TokenUsage, model: string, pricing: readonly ModelPricing[]): number | null {
  const match = pricing.find((row) => row.model === model);
  if (!match) {
    return null;
  }
  return (
    (usage.inputTokens / 1_000_000) * match.inputPerMillion +
    (usage.outputTokens / 1_000_000) * match.outputPerMillion
  );
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  unpricedCalls: number;
}

export interface UsageModelRow extends UsageTotals {
  model: string;
  providerId: string | null;
}

export interface UsageCallRow {
  id: string;
  task: string;
  providerId: string | null;
  model: string;
  resolvedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  outcome: string;
  createdAt: string;
}

export interface UsageReport {
  today: UsageTotals;
  month: UsageTotals;
  byModel: UsageModelRow[];
  recent: UsageCallRow[];
  pricing: ModelPricing[];
}
