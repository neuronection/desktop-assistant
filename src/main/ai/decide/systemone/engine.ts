import type { DecisionOutcome } from '@shared/ai/decisions';
import type { DecisionEngine, DecisionRequest } from '../types';
import { TypeSafeSdkSystemOneClient, type SystemOneClient } from './client';
import { buildQuestionSet, buildToolDispatchQuestions, questionOutcome, toolDispatchOutcome } from './projection';

export interface SystemOneEngineParams {
  apiKey: string;
  /** System One API root; the SDK appends `/v1/systemone`. */
  baseUrl: string;
  /** Model id from the assigned row — rolling alias or pinned version (D10). */
  model: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  /** Test seam: inject a transport instead of constructing the TypeSafe client. */
  client?: SystemOneClient;
}

/**
 * The `systemone` decision transport (plan 24 S4 → plan 26 S1): typed
 * questions natively, tool dispatch as a question projection, over the
 * TypeSafe SDK pointed at the assigned provider row. Cloud — the key comes
 * from the keyring via the provider row, never config.
 */
export class SystemOneDecisionEngine implements DecisionEngine {
  readonly transport = 'systemone' as const;

  private readonly client: SystemOneClient;
  private readonly model: string;

  constructor(params: SystemOneEngineParams) {
    this.model = params.model;
    this.client =
      params.client ??
      new TypeSafeSdkSystemOneClient({
        apiKey: params.apiKey,
        baseURL: params.baseUrl,
        model: params.model,
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
      return questionOutcome(result, request.questions, this.model);
    }
    const result = await this.client.systemOne({
      state: request.input,
      questions: buildToolDispatchQuestions(request.tools, request.catalogEntities),
    });
    return toolDispatchOutcome(result, request.tools, this.model);
  }
}
