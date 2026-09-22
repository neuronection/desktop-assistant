import type { DecisionOutcome } from '@shared/ai/decisions';
import type { DecisionEngine, DecisionRequest } from '../types';
import { OpenRouterJevClient, type JevClient } from './client';
import { buildQuestionSet, buildToolDispatchQuestions, questionOutcome, toolDispatchOutcome } from './projection';

export interface JevEngineParams {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /** Test seam: inject a transport instead of constructing the OpenRouter client. */
  client?: JevClient;
}

/**
 * TypeSafe System One (Jev) decision engine (plan 24 S4): typed questions
 * natively, tool dispatch as a question projection, via OpenRouter. Cloud —
 * the key comes from the keyring, never config, and the model is pinned.
 */
export class JevDecisionEngine implements DecisionEngine {
  readonly kind = 'jev' as const;

  private readonly client: JevClient;

  constructor(params: JevEngineParams = {}) {
    this.client =
      params.client ??
      new OpenRouterJevClient({
        apiKey: params.apiKey ?? '',
        ...(params.model ? { model: params.model } : {}),
        ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        ...(params.fetcher ? { fetcher: params.fetcher } : {}),
      });
  }

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    if (request.questions && request.questions.length > 0) {
      const result = await this.client.systemOne({
        state: request.input,
        questions: buildQuestionSet(request.questions),
      });
      return questionOutcome(result, request.questions);
    }
    const result = await this.client.systemOne({
      state: request.input,
      questions: buildToolDispatchQuestions(request.tools),
    });
    return toolDispatchOutcome(result, request.tools);
  }
}
