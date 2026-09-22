import { HTTPClient, OpenRouter } from '@openrouter/sdk';
import { JEV_MODEL_ID } from '@shared/ai/decisions';

type DecisionsCreateInput = Parameters<OpenRouter['alpha']['decisions']['create']>[0];
type DecisionsResponse = Awaited<ReturnType<OpenRouter['alpha']['decisions']['create']>>;
type DecisionsQuestions = DecisionsCreateInput['decisionsRequest']['questions'];

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
  cost?: number;
}

export interface TypeSafeResult {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage?: TypeSafeUsage;
}

/** The seam every Jev transport implements — production uses OpenRouter. */
export interface JevClient {
  systemOne(params: { state: string; questions: Record<string, TypeSafeQuestion> }): Promise<TypeSafeResult>;
}

export interface OpenRouterJevClientConfig {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Injectable fetch for tests / proxies (the SDK's `HTTPClient` fetcher). */
  fetcher?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

function normalizeLegend(answer: DecisionsResponse['answers'][string]): Record<string, string> {
  if (answer.type !== 'score' || !answer.legend) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(answer.legend).map(([level, description]) => [
      level,
      typeof description === 'string' ? description : JSON.stringify(description),
    ])
  );
}

function toResult(response: DecisionsResponse): TypeSafeResult {
  const answers: Record<string, TypeSafeAnswer> = {};
  for (const [id, answer] of Object.entries(response.answers)) {
    if (answer.type === 'choice') {
      answers[id] = {
        type: 'choice',
        choice: answer.choice,
        probabilities: answer.probabilities ?? {},
        confidence: answer.confidence ?? 0,
      };
    } else if (answer.type === 'noul') {
      answers[id] = { type: 'noul', noul: answer.noul };
    } else if (answer.type === 'score') {
      answers[id] = {
        type: 'score',
        score: answer.score,
        legend: normalizeLegend(answer),
        probabilities: answer.probabilities ?? {},
        confidence: answer.confidence ?? 0,
      };
    }
  }
  return {
    model: response.model,
    answers,
    ...(response.usage
      ? {
          usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            ...(response.usage.cost !== undefined ? { cost: response.usage.cost } : {}),
          },
        }
      : {}),
  };
}

function mapError(error: unknown): TypeSafeError {
  if (error instanceof TypeSafeError) {
    return error;
  }
  const message = String((error as Error)?.message ?? error).slice(0, 300);
  const status = (error as { statusCode?: number })?.statusCode;
  if (typeof status === 'number') {
    if (status === 401 || status === 402 || status === 403) {
      return new TypeSafeError('auth', message, status);
    }
    if (status === 422) {
      return new TypeSafeError('validation', message, status);
    }
    if (status === 429) {
      return new TypeSafeError('rate-limit', message, status);
    }
    if (status === 503 || status === 529) {
      return new TypeSafeError('overloaded', message, status);
    }
    return new TypeSafeError('unavailable', message, status);
  }
  const name = error instanceof Error ? error.name : '';
  if (/timeout|abort/i.test(name)) {
    return new TypeSafeError('timeout', message);
  }
  return new TypeSafeError('unavailable', message);
}

function isRetryable(kind: TypeSafeErrorKind): boolean {
  return kind === 'rate-limit' || kind === 'overloaded' || kind === 'unavailable';
}

/**
 * Jev via OpenRouter (plan 24 S4). OpenRouter serves the TypeSafe System
 * One model (`typesafe/jev-1.13`) through its own SDK, so the provider SDK
 * stays confined to the AI layer (ADR-0008/0020). The key is the user's
 * OpenRouter key (keyring); the model is pinned; a wall-clock timeout and
 * our own 429/529/transport backoff wrap the SDK call (its built-in retry
 * is disabled so behavior stays observable and testable).
 */
export class OpenRouterJevClient implements JevClient {
  private readonly openrouter: OpenRouter;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config: OpenRouterJevClientConfig) {
    this.model = config.model ?? JEV_MODEL_ID;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.openrouter = new OpenRouter({
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retryConfig: { strategy: 'none' },
      ...(config.fetcher ? { httpClient: new HTTPClient({ fetcher: config.fetcher }) } : {}),
    });
  }

  async systemOne(params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
  }): Promise<TypeSafeResult> {
    let attempt = 0;
    for (;;) {
      try {
        const response = await this.openrouter.alpha.decisions.create({
          decisionsRequest: {
            model: this.model,
            state: params.state,
            questions: params.questions as unknown as DecisionsQuestions,
          },
        });
        return toResult(response);
      } catch (error) {
        const mapped = mapError(error);
        if (!isRetryable(mapped.kind) || attempt >= this.maxRetries) {
          throw mapped;
        }
        const delay = this.retryDelayMs * 2 ** attempt;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        attempt += 1;
      }
    }
  }
}
