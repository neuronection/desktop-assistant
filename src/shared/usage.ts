export interface ModelPricing {
  /** Exact model id (or resolved model id) as the provider reports it. */
  model: string;
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

/** Loopback / LAN host detection for the automatic zero-price rule. */
export function isLocalApiBase(apiBase: string | undefined): boolean {
  try {
    const host = new URL(apiBase ?? '').hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

export interface UsageSettings {
  pricing: ModelPricing[];
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Cost in USD, or null when the model has no price or either token count is unknown. */
export function estimateCost(usage: TokenUsage, model: string, pricing: readonly ModelPricing[]): number | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) {
    return null;
  }
  const id = model.trim();
  const match = pricing.find((row) => row.model.trim() === id);
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
  /** Calls where at least one token side was missing, so the token sum is partial. */
  partialTokenCalls: number;
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
