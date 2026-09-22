import type { DecisionOutcome } from '@shared/ai/decisions';
import { JEV_MODEL_ID } from '@shared/ai/decisions';
import type { DecisionEngine, DecisionRequest } from '../types';
import { TypeSafeClient, type TypeSafeClientConfig } from './client';
import { buildQuestionSet, buildToolDispatchQuestions, questionOutcome, toolDispatchOutcome } from './projection';

export interface JevEngineParams {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * TypeSafe System One (Jev) decision engine (plan 24 S4): typed questions
 * natively, tool dispatch as a question projection. Cloud — the key comes
 * from the keyring, never config, and the model version is pinned.
 */
export class JevDecisionEngine implements DecisionEngine {
  readonly kind = 'jev' as const;

  private readonly client: TypeSafeClient;

  constructor(params: JevEngineParams) {
    const config: TypeSafeClientConfig = {
      apiKey: params.apiKey,
      model: params.model ?? JEV_MODEL_ID,
      ...(params.baseUrl ? { baseUrl: params.baseUrl } : {}),
      ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
      ...(params.maxRetries !== undefined ? { maxRetries: params.maxRetries } : {}),
      ...(params.retryDelayMs !== undefined ? { retryDelayMs: params.retryDelayMs } : {}),
      ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    };
    this.client = new TypeSafeClient(config);
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
