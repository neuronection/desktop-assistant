import type { LLMProvider, Model } from '@shared/types';
import { TypeSafeError, TypeSafeSdkSystemOneClient, resolveSystemOneBaseUrl } from './client';

/** Family default abort timeout for validation probes (ai-features §15/D18). */
export const DECISION_PROBE_TIMEOUT_MS = 10_000;

export interface DecisionProbeInput {
  provider: LLMProvider;
  model: Model;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface DecisionProbeResult {
  ok: boolean;
  latencyMs: number;
  /** Provider-reported model version, when the transport reports one (D10). */
  resolvedModel?: string;
  /** HTTP status of a classified failure, when the transport reports one. */
  status?: number;
  error?: string;
}

const PROBE_QUESTION_ID = '__probe__';

/**
 * The decision probe (plan 26 D13/D18): one minimal typed question under
 * the abort timeout — the decision-only-provider counterpart of the
 * fetch-first catalog validation. A classified failure persists nothing;
 * the caller rolls back.
 */
export async function probeDecisionProvider(input: DecisionProbeInput): Promise<DecisionProbeResult> {
  const startedAt = Date.now();
  const baseUrl = resolveSystemOneBaseUrl(input.provider, input.model);
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: 'The provider base URL is missing or invalid.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? DECISION_PROBE_TIMEOUT_MS);
  try {
    const client = new TypeSafeSdkSystemOneClient({
      apiKey: input.apiKey,
      baseURL: baseUrl,
      model: input.model.id,
      timeoutMs: input.timeoutMs ?? DECISION_PROBE_TIMEOUT_MS,
      maxRetries: 0,
      ...(input.fetchImpl ? { fetcher: input.fetchImpl } : {}),
    });
    const result = await client.systemOne({
      state: 'connectivity check',
      questions: {
        [PROBE_QUESTION_ID]: {
          type: 'noul',
          instructions: 'Is this a working decision endpoint? Answer true.',
        },
      },
    });
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      ...(result.model ? { resolvedModel: result.model } : {}),
    };
  } catch (error) {
    const message =
      error instanceof TypeSafeError
        ? error.message
        : String((error as Error)?.message ?? error).slice(0, 300);
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      ...(error instanceof TypeSafeError && error.status !== undefined ? { status: error.status } : {}),
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}
