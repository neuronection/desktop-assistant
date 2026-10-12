import { AiTask } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import type {
  DecisionCapability,
  DecisionConfidenceBand,
  DecisionOutcome,
  DecisionQuestion,
  DecisionToolSchema,
  DecisionTransport,
} from '@shared/ai/decisions';
import { capabilityForQuestions, decisionBand } from '@shared/ai/decisions';
import { recordAiCall } from '../audit';
import { decisionSlots, withDecisionSlot, type DecisionPriority } from './limiter';
export { decisionSlots };
import type { DecisionRequest } from './types';
import { assembleDecisionPrompt } from './prompt';
import {
  getDecisionTransportRegistration,
  resolveDecision,
  type DecisionEngineDeps,
} from './registry';

export type {
  DecisionEngineDeps,
  DecisionTransportRegistration,
  DecisionResolution,
} from './registry';
export {
  clearDecisionResolutionCache,
  decisionTransportCapabilities,
  decisionTransportDisplayName,
  decisionTransportOf,
  engineReadiness,
  getDecisionTransportRegistration,
  resolutionTransport,
  resolveDecision,
} from './registry';

export type DecisionStatus =
  | { status: 'off' }
  | { status: 'unconfigured'; reason: string }
  | { status: 'unavailable'; reason: string; code?: 'needs-key'; providerId?: string }
  | { status: 'error'; reason: string; transport?: DecisionTransport }
  | { status: 'decided'; band: DecisionConfidenceBand; outcome: DecisionOutcome };

export type RunDecisionDeps = DecisionEngineDeps;

export interface RunDecisionParams {
  config: AppConfig;
  input: string;
  tools: DecisionToolSchema[];
  systemPrompt?: string;
  /** Typed-question request (plan 24 S5); mutually exclusive with tool dispatch. */
  questions?: DecisionQuestion[];
  /** Catalog ids per app (plan 24 S4b) grounding entity args as a Choice. */
  catalogEntities?: ReadonlyMap<string, readonly string[]>;
  /** Concurrency priority at the shared funnel limiter (plan 26 S3) — background runs yield. */
  priority?: DecisionPriority;
  /**
   * The decision capability this request needs (plan 26 S1). Defaults to
   * the derived slot: typed questions → choice/score/boolean-gate, tool
   * dispatch → `tool-dispatch`.
   */
  capability?: DecisionCapability;
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
      ...(result?.resolvedModel ? { resolvedModel: result.resolvedModel } : {}),
      durationMs: Date.now() - startedAt,
      outcome,
      ...(error !== undefined ? { error: String((error as Error)?.message ?? error).slice(0, 500) } : {}),
      ...(result?.usage
        ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        : {}),
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
 * The decision funnel (plan 20, registry-based since plan 24 S1, slot-based
 * since plan 26 S1): resolve `decision:<cap>` slot → model → provider →
 * invoke → audit → band. Every non-`decided` status means "fall through to
 * the standard agent path" (D4) — the caller never dead-ends.
 */
export async function runDecision(deps: RunDecisionDeps, params: RunDecisionParams): Promise<DecisionStatus> {
  const capability =
    params.capability ??
    (params.questions && params.questions.length > 0
      ? capabilityForQuestions(params.questions)
      : 'tool-dispatch');
  const resolution = await resolveDecision(capability, params.config, deps);
  if (resolution.kind !== 'systemone') {
    if (resolution.kind === 'off') {
      return { status: 'off' };
    }
    if (resolution.kind === 'unavailable') {
      return {
        status: 'unavailable',
        reason: resolution.reason,
        ...(resolution.code ? { code: resolution.code, providerId: resolution.providerId } : {}),
      };
    }
    if (resolution.kind === 'unconfigured') {
      return { status: 'unconfigured', reason: resolution.reason };
    }
    return { status: 'error', reason: 'unresolvable decision model' };
  }
  const transport = resolution.kind;
  const registration = getDecisionTransportRegistration(transport);
  const meta = registration.audit(resolution);
  if (!meta) {
    return { status: 'error', reason: 'no audit meta for decision resolution' };
  }
  const request: DecisionRequest = {
    input: params.input,
    tools: params.tools,
    systemPrompt: params.systemPrompt ?? assembleDecisionPrompt(params.config.decision),
    ...(params.questions ? { questions: params.questions } : {}),
    ...(params.catalogEntities ? { catalogEntities: params.catalogEntities } : {}),
  };
  const startedAt = Date.now();
  try {
    let outcome = await withDecisionSlot(params.priority ?? 'interactive', async () =>
      auditDecision(meta, startedAt, async () => {
        const engine = await registration.create(resolution, deps);
        return engine.decide(request);
      })
    );
    if (outcome.resolvedModel && outcome.resolvedModel !== resolution.model.id && deps.observeResolvedModel) {
      await deps.observeResolvedModel(resolution.model.id, outcome.resolvedModel).catch(() => undefined);
    }
    outcome = { ...outcome, engine: outcome.engine || resolution.model.id };
    return { status: 'decided', band: decisionBand(outcome.confidence, params.config.decision), outcome };
  } catch (error) {
    return {
      status: 'error',
      reason: String((error as Error)?.message ?? error).slice(0, 500),
      transport,
    };
  }
}
