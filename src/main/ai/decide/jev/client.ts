import { JEV_DEFAULT_BASE_URL } from '@shared/ai/decisions';

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
  input_tokens: number;
  output_tokens: number;
}

export interface TypeSafeResult {
  model: string;
  answers: Record<string, TypeSafeAnswer>;
  usage?: TypeSafeUsage;
}

export interface TypeSafeClientConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxConcurrent?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_CONCURRENT = 2;

function statusKind(status: number): TypeSafeErrorKind {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 422) {
    return 'validation';
  }
  if (status === 429) {
    return 'rate-limit';
  }
  if (status === 529) {
    return 'overloaded';
  }
  return 'unavailable';
}

/**
 * Thin client over the TypeSafe System One endpoint (plan 24 S4). Raw
 * `fetch` — the sanctioned non-chat endpoint surface (ADR-0018/0020), no
 * provider SDK dependency while Jev is in early access. Injectable fetch,
 * wall-clock timeout, typed errors, exponential backoff on 429/529, and a
 * concurrency cap (rate limits exist).
 */
export class TypeSafeClient {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly config: TypeSafeClientConfig) {}

  private async acquire(): Promise<() => void> {
    const max = this.config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    if (this.active >= max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.active -= 1;
      this.waiters.shift()?.();
    };
  }

  async systemOne(params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
  }): Promise<TypeSafeResult> {
    const release = await this.acquire();
    try {
      return await this.withRetry(params);
    } finally {
      release();
    }
  }

  private async withRetry(params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
  }): Promise<TypeSafeResult> {
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    let attempt = 0;
    for (;;) {
      try {
        return await this.request(params);
      } catch (error) {
        const kind = error instanceof TypeSafeError ? error.kind : 'unavailable';
        const retryable = kind === 'rate-limit' || kind === 'overloaded' || kind === 'unavailable';
        if (!retryable || attempt >= maxRetries) {
          throw error;
        }
        const delay = (this.config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** attempt;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        attempt += 1;
      }
    }
  }

  private async request(params: {
    state: string;
    questions: Record<string, TypeSafeQuestion>;
  }): Promise<TypeSafeResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const base = (this.config.baseUrl ?? JEV_DEFAULT_BASE_URL).replace(/\/$/, '');
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${base}/systemone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, state: params.state, questions: params.questions }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TypeSafeError('timeout', `TypeSafe request timed out after ${timeoutMs}ms`);
      }
      throw new TypeSafeError('unavailable', String((error as Error)?.message ?? error).slice(0, 200));
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new TypeSafeError(statusKind(response.status), body.slice(0, 200) || `HTTP ${response.status}`, response.status);
    }
    const payload = (await response.json().catch(() => null)) as TypeSafeResult | null;
    if (!payload || typeof payload !== 'object' || !payload.answers) {
      throw new TypeSafeError('validation', 'TypeSafe returned no answers');
    }
    return payload;
  }
}
