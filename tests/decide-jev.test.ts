import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { JEV_MODEL_ID, type DecisionQuestion, type DecisionToolSchema } from '@shared/ai/decisions';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { runDecision } from '@main/ai/decide';
import { TypeSafeClient, TypeSafeError } from '@main/ai/decide/jev/client';
import { JevDecisionEngine } from '@main/ai/decide/jev/engine';
import {
  buildToolDispatchQuestions,
  NONE_OPTION,
  TOOL_CHOICE_ID,
} from '@main/ai/decide/jev/projection';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [],
  customModels: [],
};

function config(engine: 'jev' | 'llm'): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    decision: { engine, actThreshold: 0.85, confirmThreshold: 0.5 },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const TOOLS: DecisionToolSchema[] = [
  {
    name: 'media_controls',
    description: 'Control media playback.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'pause', 'next'] },
        shuffle: { type: 'boolean' },
      },
    },
  },
];

const DISPATCH_RESULT = {
  model: JEV_MODEL_ID,
  answers: {
    [TOOL_CHOICE_ID]: { type: 'choice', choice: 'media_controls', probabilities: { media_controls: 0.92 }, confidence: 0.92 },
    'media_controls.action': { type: 'choice', choice: 'pause', probabilities: { pause: 0.9 }, confidence: 0.9 },
    'media_controls.shuffle': { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 120, output_tokens: 12 },
};

describe('TypeSafeClient (plan 24 S4)', () => {
  it('posts the model, state and questions to the endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: JEV_MODEL_ID, answers: {} }));
    const client = new TypeSafeClient({ apiKey: 'secret', model: JEV_MODEL_ID, fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.systemOne({ state: 'hi', questions: { q: { type: 'noul', instructions: 'yes?' } } });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: JEV_MODEL_ID, state: 'hi' });
  });

  it('maps 401 to an auth error without retrying', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    const client = new TypeSafeClient({ apiKey: 'bad', model: JEV_MODEL_ID, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.systemOne({ state: 'x', questions: {} })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with backoff then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse({ model: JEV_MODEL_ID, answers: { q: { type: 'noul', noul: 0.7 } } }));
    const client = new TypeSafeClient({
      apiKey: 'k',
      model: JEV_MODEL_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 1,
      retryDelayMs: 0,
    });
    const result = await client.systemOne({ state: 'x', questions: {} });
    expect(result.answers.q).toMatchObject({ noul: 0.7 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled request', async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = new TypeSafeClient({
      apiKey: 'k',
      model: JEV_MODEL_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
      maxRetries: 0,
    });
    await expect(client.systemOne({ state: 'x', questions: {} })).rejects.toBeInstanceOf(TypeSafeError);
    await expect(client.systemOne({ state: 'x', questions: {} })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('Jev tool-dispatch projection (plan 24 S4)', () => {
  it('asks a __tool__ choice that always carries a __none__ out', () => {
    const questions = buildToolDispatchQuestions(TOOLS);
    const tool = questions[TOOL_CHOICE_ID];
    expect(tool?.type).toBe('choice');
    expect(tool?.type === 'choice' ? Object.keys(tool.criteria) : []).toEqual(['__none__', 'media_controls']);
    expect(questions['media_controls.action']).toMatchObject({ type: 'choice' });
    expect(questions['media_controls.shuffle']).toMatchObject({ type: 'noul' });
  });

  it('maps answers to a call, dropping low-confidence flags and taking the least-certain confidence', async () => {
    const engine = new JevDecisionEngine({
      apiKey: 'k',
      fetchImpl: (async () => jsonResponse(DISPATCH_RESULT)) as unknown as typeof fetch,
    });
    const outcome = await engine.decide({ input: 'pause the music', tools: TOOLS });
    expect(outcome.engine).toBe('jev');
    expect(outcome.calls).toEqual([{ tool: 'media_controls', args: { action: 'pause' } }]);
    expect(outcome.confidence).toBeCloseTo(0.9);
  });

  it('returns no calls when the model picks __none__', async () => {
    const engine = new JevDecisionEngine({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({
          model: JEV_MODEL_ID,
          answers: {
            [TOOL_CHOICE_ID]: { type: 'choice', choice: NONE_OPTION, probabilities: { __none__: 0.97 }, confidence: 0.97 },
          },
        })) as unknown as typeof fetch,
    });
    const outcome = await engine.decide({ input: 'what is the capital of France', tools: TOOLS });
    expect(outcome.calls).toEqual([]);
    expect(outcome.confidence).toBeCloseTo(0.97);
  });

  it('answers typed questions natively', async () => {
    const questions: DecisionQuestion[] = [
      { id: 'speak', type: 'noul', instructions: 'Should the reply be spoken aloud?' },
    ];
    const engine = new JevDecisionEngine({
      apiKey: 'k',
      fetchImpl: (async () =>
        jsonResponse({
          model: JEV_MODEL_ID,
          answers: { speak: { type: 'noul', noul: 0.82 } },
        })) as unknown as typeof fetch,
    });
    const outcome = await engine.decide({ input: 'read this out loud', tools: [], questions });
    expect(outcome.answers?.speak).toEqual({ type: 'noul', noul: 0.82 });
    expect(outcome.confidence).toBeCloseTo(0.82);
  });
});

describe('Jev through the funnel (plan 24 S4)', () => {
  const audit: AiCallRecord[] = [];

  beforeEach(() => {
    audit.length = 0;
    setAuditSink(async (record) => {
      audit.push(record);
    });
  });

  it('decides and audits model jev-1.13.0 with no providerId', async () => {
    const result = await runDecision(
      {
        getApiKey: async () => null,
        getJevKey: async () => 'typesafe-key',
        fetchImpl: (async () => jsonResponse(DISPATCH_RESULT)) as unknown as typeof fetch,
      },
      { config: config('jev'), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'act', outcome: { engine: 'jev' } });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: JEV_MODEL_ID, outcome: 'ok' });
    expect(audit.at(-1)?.providerId).toBeUndefined();
  });

  it('is unavailable without a keyring key', async () => {
    const result = await runDecision(
      { getApiKey: async () => null },
      { config: config('jev'), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'unavailable', engine: 'jev' });
  });

  it('fails open (error status) when the API errors', async () => {
    const result = await runDecision(
      {
        getApiKey: async () => null,
        getJevKey: async () => 'typesafe-key',
        fetchImpl: (async () => jsonResponse({ error: 'bad' }, 422)) as unknown as typeof fetch,
      },
      { config: config('jev'), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'error', engine: 'jev' });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: JEV_MODEL_ID, outcome: 'error' });
  });
});
