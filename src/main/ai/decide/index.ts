import { AiTask, type LLMProvider } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import { resolveTaskModel } from '@shared/ai/tasks';
import type { DecisionConfidenceBand, DecisionOutcome, DecisionSettings, DecisionToolSchema } from '@shared/ai/decisions';
import { decisionBand } from '@shared/ai/decisions';
import { recordAiCall } from '../audit';
import type { StructuredModelFactory } from '../chat-models';
import type { DecisionEngine, DecisionRequest } from './types';
import { LlmDecisionEngine } from './llm';
import { NEEDLE_MODEL_ID } from './needle/pins';
import { locateVerifiedWeights } from './needle/weights';
import { NeedleDecisionEngine } from './needle/engine';
import type { NeedleTransportFactory } from './needle/transport';

export type DecisionStatus =
  | { status: 'off' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'error'; reason: string }
  | { status: 'decided'; band: DecisionConfidenceBand; outcome: DecisionOutcome };

export interface NeedleContext {
  userDataDir(): Promise<string>;
  resourceDir(): Promise<string>;
  createTransport?: NeedleTransportFactory;
  locateWeights?: (userDataDir: string) => Promise<string | null>;
}

export interface RunDecisionDeps {
  getApiKey(provider: LLMProvider): Promise<string | null>;
  createStructuredModel?: StructuredModelFactory;
  needle?: NeedleContext;
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
  | { kind: 'llm-engine'; provider: LLMProvider; modelId: string; createModel?: StructuredModelFactory }
  | { kind: 'needle-engine'; weightsPath: string; resourceDir: string; createTransport?: NeedleTransportFactory };

export function resolveDecisionEngine(
  settings: DecisionSettings,
  config: AppConfig,
  deps: Pick<RunDecisionDeps, 'createStructuredModel'>
): { kind: 'off' } | { kind: 'unconfigured'; reason: string } | Extract<DecisionEngineResolution, { kind: 'llm-engine' }> {
  if (settings.engine === 'off') {
    return { kind: 'off' };
  }
  if (settings.engine === 'needle') {
    throw new Error('needle resolution is async — use resolveDecisionEngineAsync');
  }  const resolution = resolveTaskModel(config, AiTask.INTENT) ?? resolveTaskModel(config, AiTask.CHAT);
  if (!resolution) {
    return { kind: 'unconfigured', reason: 'No model is assigned for decisions or chat in settings.' };
  }
  return {
    kind: 'llm-engine',
    provider: resolution.provider,
    modelId: resolution.modelId,
    ...(deps.createStructuredModel ? { createModel: deps.createStructuredModel } : {}),
  };
}

const defaultNeedleContext: NeedleContext = {
  async userDataDir() {
    return (await import('./needle/context')).needleUserDataDir();
  },
  async resourceDir() {
    return (await import('./needle/context')).needleResourceDir();
  },
};

export async function resolveDecisionEngineAsync(
  settings: DecisionSettings,
  config: AppConfig,
  deps: RunDecisionDeps
): Promise<DecisionEngineResolution> {
  if (settings.engine === 'off') {
    return { kind: 'off' };
  }
  if (settings.engine === 'needle') {
    const needle = deps.needle ?? defaultNeedleContext;
    const userDataDir = await needle.userDataDir();
    const weightsPath = needle.locateWeights
      ? await needle.locateWeights(userDataDir)
      : await locateVerifiedWeights(userDataDir);
    if (!weightsPath) {
      return { kind: 'unavailable', reason: 'Needle weights are not downloaded yet (download from Settings).' };
    }
    return {
      kind: 'needle-engine',
      weightsPath,
      resourceDir: await needle.resourceDir(),
      ...(needle.createTransport ? { createTransport: needle.createTransport } : {}),
    };
  }
  return resolveDecisionEngine(settings, config, deps);
}

async function buildEngine(deps: RunDecisionDeps, resolution: DecisionEngineResolution): Promise<DecisionEngine> {
  if (resolution.kind === 'needle-engine') {
    return new NeedleDecisionEngine(resolution);
  }
  if (resolution.kind === 'llm-engine') {
    const apiKey = (await deps.getApiKey(resolution.provider)) ?? '';
    return new LlmDecisionEngine({
      provider: resolution.provider,
      modelId: resolution.modelId,
      apiKey,
      ...(resolution.createModel ? { createModel: resolution.createModel } : {}),
    });
  }
  throw new Error('no engine to build');
}

function auditMeta(resolution: DecisionEngineResolution): { providerId?: string; model: string } | null {
  if (resolution.kind === 'llm-engine') {
    return { providerId: resolution.provider.id, model: resolution.modelId };
  }
  if (resolution.kind === 'needle-engine') {
    return { model: NEEDLE_MODEL_ID };
  }
  return null;
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
  const resolution = await resolveDecisionEngineAsync(params.config.decision, params.config, deps);
  if (resolution.kind !== 'llm-engine' && resolution.kind !== 'needle-engine') {
    return { status: resolution.kind, ...(resolution.kind === 'off' ? {} : { reason: resolution.reason }) } as DecisionStatus;
  }
  const meta = auditMeta(resolution);
  if (!meta) {
    return { status: 'error', reason: 'no audit meta for engine resolution' };
  }
  const request: DecisionRequest = {
    input: params.input,
    tools: params.tools,
    ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
  };
  const startedAt = Date.now();
  try {
    const outcome = await auditDecision(meta, startedAt, async () => {
      const engine = await buildEngine(deps, resolution);
      return engine.decide(request);
    });
    return { status: 'decided', band: decisionBand(outcome.confidence, params.config.decision), outcome };
  } catch (error) {
    return { status: 'error', reason: String((error as Error)?.message ?? error).slice(0, 500) };
  }
}
