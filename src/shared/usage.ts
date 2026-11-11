import type { UserPriceRow } from './modelPricing';

/** A user-maintained price override (micro-USD per million tokens). */
export type ModelPricing = UserPriceRow;

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

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Recorded call-time cost; null when no call could be priced. */
  costMicros: number | null;
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
  costMicros: number | null;
  outcome: string;
  createdAt: string;
}

export interface UsageReport {
  today: UsageTotals;
  month: UsageTotals;
  byModel: UsageModelRow[];
  recent: UsageCallRow[];
}
