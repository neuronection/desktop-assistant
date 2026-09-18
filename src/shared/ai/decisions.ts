/**
 * Decision engines (plan 20): intent routing + tool dispatch as a
 * sibling capability to chat — never a replacement. Shared surface so
 * both processes speak the same shapes; invocation lives in
 * `src/main/ai/decide/`.
 */

export type DecisionEngineKind = 'off' | 'llm' | 'needle';

export const DECISION_ENGINE_KINDS: readonly DecisionEngineKind[] = ['off', 'llm', 'needle'];

export const DECISION_ACT_THRESHOLD_DEFAULT = 0.85;
export const DECISION_CONFIRM_THRESHOLD_DEFAULT = 0.5;

export interface DecisionSettings {
  /** `off` keeps behavior byte-identical to pre-plan-20 (D1). */
  engine: DecisionEngineKind;
  /** Confidence ≥ actThreshold executes without extra confirmation (D4). */
  actThreshold: number;
  /** Confidence ≥ confirmThreshold routes into the approval card (D4). */
  confirmThreshold: number;
}

function clampThreshold(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, n));
}

export function mergeDecisionSettings(partial: Partial<DecisionSettings> | undefined): DecisionSettings {
  const act = clampThreshold(partial?.actThreshold, DECISION_ACT_THRESHOLD_DEFAULT);
  const confirm = clampThreshold(partial?.confirmThreshold, DECISION_CONFIRM_THRESHOLD_DEFAULT);
  const engine: DecisionEngineKind = DECISION_ENGINE_KINDS.includes(partial?.engine as DecisionEngineKind)
    ? (partial?.engine as DecisionEngineKind)
    : 'off';
  return {
    engine,
    actThreshold: Math.max(act, confirm),
    confirmThreshold: Math.min(act, confirm),
  };
}

export type DecisionConfidenceBand = 'act' | 'confirm' | 'refuse';

export function decisionBand(confidence: number, settings: DecisionSettings): DecisionConfidenceBand {
  if (confidence >= settings.actThreshold) {
    return 'act';
  }
  if (confidence >= settings.confirmThreshold) {
    return 'confirm';
  }
  return 'refuse';
}

/** Engine-neutral tool projection (JSON-schema-ish parameters). */
export interface DecisionToolSchema {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface DecisionCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface DecisionOutcome {
  engine: Exclude<DecisionEngineKind, 'off'>;
  calls: DecisionCall[];
  confidence: number;
  reasoning?: string;
}

export function sanitizeConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}
