import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
} from '@typesafe-ai/sdk';
import type { Fetch, Questions, SystemOneResult } from '@typesafe-ai/sdk';
import { JEV_BASE_URL, JEV_MODEL_ID, isValidHttpUrl } from '@shared/ai/decisions';

export type TypeSafeErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'validation'
  | 'timeout'
  | 'unavailable';

export class TypeSafeError extends Error {
  constructor(
    readonly kind: TypeSafeErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'TypeSafeError';
  }
}

export type TypeSafeQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: string; criteria: Record<string, unknown> }
  | { type: 'score'; instructions: string; criteria: (string | Record<string, unknown>)[] };

export type TypeSafeAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | {
      type: 'score';
      score: number;
      legend: Record<string, string>;
      probabilities: Record<string, number>;
      confidence: number;
    };

export interface TypeSafeUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TypeSafeResult {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage?: TypeSafeUsage;
}

/** The seam every Jev transport implements — production uses the TypeSafe SDK. */
export interface JevClient {
  systemOne(params: { state: string; questions: Record<string, TypeSafeQuestion> }): Promise<TypeSafeResult>;
}

export interface TypeSafeSdkJevClientConfig {
  apiKey: string;
  /** API root; defaults to OpenRouter (see `JEV_BASE_URL`). */
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable fetch for tests / proxies. */
  fetcher?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function normalizeLegend(legend: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(legend).map(([level, description]) => [
      level,
      typeof description === 'string' ? description : JSON.stringify(description),
    ])
  );
}

function toResult(result: SystemOneResult<Questions>): TypeSafeResult {
  const answers: Record<string, TypeSafeAnswer> = {};
  for (const [id, answer] of Object.entries(result.answers)) {
    if (answer.type === 'choice') {
      answers[id] = {
        type: 'choice',
        choice: answer.choice,
        probabilities: { ...answer.probabilities },
        confidence: answer.confidence,
      };
    } else if (answer.type === 'noul') {
      answers[id] = { type: 'noul', noul: answer.noul };
    } else if (answer.type === 'score') {
      answers[id] = {
        type: 'score',
        score: answer.score,
        legend: normalizeLegend(answer.legend as Record<string, unknown>),
        probabilities: { ...answer.probabilities },
        confidence: answer.confidence,
      };
    }
  }
  return {
    model: result.model,
    answers,
    usage: {
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
    },
  };
}

function mapError(error: unknown): TypeSafeError {
  if (error instanceof TypeSafeError) {
    return error;
  }
  if (error instanceof APIError) {
    const status = error.status;
    if (status === 401 || status === 402 || status === 403) {
      return new TypeSafeError('auth', error.message, status);
    }
    if (status === 400 || status === 422) {
      return new TypeSafeError('validation', error.message, status);
    }
    if (status === 429) {
      return new TypeSafeError('rate-limit', error.message, status);
    }
    if (status === 503 || status === 529) {
      return new TypeSafeError('overloaded', error.message, status);
    }
    return new TypeSafeError('unavailable', error.message, status);
  }
  if (error instanceof APITimeoutError || error instanceof APIUserAbortError) {
    return new TypeSafeError('timeout', error.message);
  }
  if (error instanceof APIConnectionError) {
    return new TypeSafeError('unavailable', error.message);
  }
  return new TypeSafeError('unavailable', String((error as Error)?.message ?? error).slice(0, 300));
}

/**
 * Jev via the official TypeSafe SDK, pointed at OpenRouter (plan 24 S4).
 * OpenRouter's `/v1/systemone` is documented as compatible with the
 * TypeSafe SDKs and maps the bare model alias onto `typesafe/`. The SDK is
 * confined to the AI layer (ADR-0008/0020); the key is the user's
 * OpenRouter key from the keyring, and the model follows Jev's rolling
 * alias (`jev-latest`) rather than a pinned version, so version churn on
 * the provider side doesn't break the app.
 */
export class TypeSafeSdkJevClient implements JevClient {
  private readonly client: TypeSafeClient;

  constructor(config: TypeSafeSdkJevClientConfig) {
    const baseURL = config.baseURL && isValidHttpUrl(config.baseURL) ? config.baseURL : JEV_BASE_URL;
    this.client = new TypeSafeClient({
      apiKey: config.apiKey,
      baseURL,
      defaultModel: config.model ?? JEV_MODEL_ID,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(config.maxRetries !== undefined ? { retry: { maxRetries: config.maxRetries } } : {}),
      ...(config.fetcher ? { fetch: config.fetcher as Fetch } : {}),
    });
  }

  async systemOne(params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
  }): Promise<TypeSafeResult> {
    try {
      const result = await this.client.systemOne({
        state: params.state,
        questions: params.questions as unknown as Questions,
      });
      return toResult(result);
    } catch (error) {
      throw mapError(error);
    }
  }
}
