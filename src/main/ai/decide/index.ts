import { AiTask } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import type { DecisionConfidenceBand, DecisionOutcome, DecisionToolSchema } from '@shared/ai/decisions';
import { decisionBand } from '@shared/ai/decisions';
import { recordAiCall } from '../audit';
import type { DecisionRequest } from './types';
import { assembleDecisionPrompt } from './prompt';
import { getDecisionEngineRegistration, resolveDecisionEngine, type DecisionEngineDeps } from './registry';

export type {
  DecisionEngineDeps,
  DecisionEngineRegistration,
  DecisionEngineResolution,
  NeedleContext,
} from './registry';
export {
  decisionEngineCapabilities,
  decisionEngineDisplayName,
  decisionEngineTraceModel,
  engineReadiness,
  getDecisionEngineRegistration,
  resolveDecisionEngine,
} from './registry';

export type DecisionStatus =
  | { status: 'off' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'unavailable'; reason: string; engine?: import('./types').RuntimeEngineKind }
  | { status: 'error'; reason: string; engine?: import('./types').RuntimeEngineKind }
  | { status: 'decided'; band: DecisionConfidenceBand; outcome: DecisionOutcome };

export type RunDecisionDeps = DecisionEngineDeps;

export interface RunDecisionParams {
  config: AppConfig;
  input: string;
  tools: DecisionToolSchema[];
  systemPrompt?: string;
}

async function auditDecision(
  meta: { providerId?: string; model: string },
  startedAt: number,
  run: () => Promise<DecisionOutcome>
): Promise<DecisionOutcome> {
  const finish = async (outcome: 'ok' | 'error', error?: unknown, result?: DecisionOutcome) => {
    await recordAiCall({
      task: AiTask.INTENT,
      ...(meta.providerId ? { providerId: meta.providerId } : {}),
      model: meta.model,
      durationMs: Date.now() - startedAt,
      outcome,
      ...(error !== undefined ? { error: String((error as Error)?.message ?? error).slice(0, 500) } : {}),
    });
    if (error !== undefined) {
      throw error;
    }
    return result as DecisionOutcome;
  };
  return run().then(
    (result) => finish('ok', undefined, result),
    (error) => finish('error', error)
  );
}

/**
 * The decision funnel (plan 20, registry-based since plan 24 S1): resolve
 * engine → invoke → audit → band. Every non-`decided` status means "fall
 * through to the standard agent path" (D4) — the caller never dead-ends.
 */
export async function runDecision(deps: RunDecisionDeps, params: RunDecisionParams): Promise<DecisionStatus> {
  const resolution = await resolveDecisionEngine(params.config.decision, params.config, deps);
  if (resolution.kind !== 'llm-engine' && resolution.kind !== 'needle-engine') {
    if (resolution.kind === 'off') {
      return { status: 'off' };
    }
    if (resolution.kind === 'unavailable') {
      return {
        status: 'unavailable',
        reason: resolution.reason,
        ...(resolution.engine ? { engine: resolution.engine } : {}),
      };
    }
    return { status: 'unconfigured', reason: resolution.reason };
  }
  const registration = getDecisionEngineRegistration(resolution.kind === 'needle-engine' ? 'needle' : 'llm');
  const meta = registration.audit(resolution);
  if (!meta) {
    return { status: 'error', reason: 'no audit meta for engine resolution' };
  }
  const request: DecisionRequest = {
    input: params.input,
    tools: params.tools,
    systemPrompt: params.systemPrompt ?? assembleDecisionPrompt(params.config.decision),
  };
  const startedAt = Date.now();
  try {
    const outcome = await auditDecision(meta, startedAt, async () => {
      const engine = await registration.create(resolution, deps);
      return engine.decide(request);
    });
    return { status: 'decided', band: decisionBand(outcome.confidence, params.config.decision), outcome };
  } catch (error) {
    return {
      status: 'error',
      reason: String((error as Error)?.message ?? error).slice(0, 500),
      engine: resolution.kind === 'needle-engine' ? 'needle' : 'llm',
    };
  }
}
