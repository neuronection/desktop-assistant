import { AiTask, type LLMProvider } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import { resolveTaskModel } from '@shared/ai/tasks';
import type { DecisionConfidenceBand, DecisionOutcome, DecisionSettings, DecisionToolSchema } from '@shared/ai/decisions';
import { decisionBand } from '@shared/ai/decisions';
import { recordAiCall } from '../audit';
import type { StructuredModelFactory } from '../chat-models';
import type { DecisionEngine, DecisionRequest } from './types';
import { LlmDecisionEngine } from './llm';

export type DecisionStatus =
  | { status: 'off' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string }
  | { status: 'decided'; band: DecisionConfidenceBand; outcome: DecisionOutcome };

export interface RunDecisionDeps {
  getApiKey(provider: LLMProvider): Promise<string | null>;
  createStructuredModel?: StructuredModelFactory;
}

export interface RunDecisionParams {
  config: AppConfig;
  input: string;
  tools: DecisionToolSchema[];
  systemPrompt?: string;
}

export type DecisionEngineResolution =
  | { kind: 'off' }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'engine'; provider: LLMProvider; modelId: string; createModel?: StructuredModelFactory };

export function resolveDecisionEngine(
  settings: DecisionSettings,
  config: AppConfig,
  deps: Pick<RunDecisionDeps, 'createStructuredModel'>
): DecisionEngineResolution {
  if (settings.engine === 'off') {
    return { kind: 'off' };
  }
  if (settings.engine === 'needle') {
    return { kind: 'unavailable', reason: 'The local Needle engine is not installed yet (plan 20 S2).' };
  }
  const resolution = resolveTaskModel(config, AiTask.INTENT) ?? resolveTaskModel(config, AiTask.CHAT);
  if (!resolution) {
    return { kind: 'unconfigured', reason: 'No model is assigned for decisions or chat in settings.' };
  }
  return {
    kind: 'engine',
    provider: resolution.provider,
    modelId: resolution.modelId,
    ...(deps.createStructuredModel ? { createModel: deps.createStructuredModel } : {}),
  };
}

async function buildEngine(
  deps: RunDecisionDeps,
  resolution: Extract<DecisionEngineResolution, { kind: 'engine' }>
): Promise<DecisionEngine> {
  const apiKey = (await deps.getApiKey(resolution.provider)) ?? '';
  return new LlmDecisionEngine({
    provider: resolution.provider,
    modelId: resolution.modelId,
    apiKey,
    ...(resolution.createModel ? { createModel: resolution.createModel } : {}),
  });
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
 * The decision funnel (plan 20): resolve engine → invoke → audit → band.
 * Every non-`decided` status means "fall through to the standard agent
 * path" (D4) — the caller never dead-ends.
 */
export async function runDecision(deps: RunDecisionDeps, params: RunDecisionParams): Promise<DecisionStatus> {
  const resolution = resolveDecisionEngine(params.config.decision, params.config, deps);
  if (resolution.kind !== 'engine') {
    return { status: resolution.kind, ...(resolution.kind === 'off' ? {} : { reason: resolution.reason }) } as DecisionStatus;
  }
  const request: DecisionRequest = {
    input: params.input,
    tools: params.tools,
    ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
  };
  const startedAt = Date.now();
  try {
    const engine = await buildEngine(deps, resolution);
    const outcome = await auditDecision(
      { providerId: resolution.provider.id, model: resolution.modelId },
      startedAt,
      () => engine.decide(request)
    );
    return { status: 'decided', band: decisionBand(outcome.confidence, params.config.decision), outcome };
  } catch (error) {
    return { status: 'error', reason: String((error as Error)?.message ?? error).slice(0, 500) };
  }
}
