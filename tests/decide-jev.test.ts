import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { JEV_MODEL_ID, type DecisionQuestion, type DecisionToolSchema } from '@shared/ai/decisions';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { runDecision } from '@main/ai/decide';
import { TypeSafeSdkJevClient, type JevClient, type TypeSafeResult } from '@main/ai/decide/jev/client';
import { JevDecisionEngine } from '@main/ai/decide/jev/engine';
import { buildToolDispatchQuestions, NONE_OPTION, TOOL_CHOICE_ID } from '@main/ai/decide/jev/projection';

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

function clientReturning(result: TypeSafeResult): JevClient {
  return { systemOne: async () => result };
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

const DISPATCH_RESULT: TypeSafeResult = {
  model: JEV_MODEL_ID,
  answers: {
    [TOOL_CHOICE_ID]: { type: 'choice', choice: 'media_controls', probabilities: { media_controls: 0.92 }, confidence: 0.92 },
    'media_controls.action': { type: 'choice', choice: 'pause', probabilities: { pause: 0.9 }, confidence: 0.9 },
    'media_controls.shuffle': { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 120, output_tokens: 12 },
};

const QUESTION = { q: { type: 'noul' as const, instructions: 'yes?' } };

describe('TypeSafe SDK Jev client via OpenRouter (plan 24 S4)', () => {
  it('maps a systemone response into typed answers', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        model: JEV_MODEL_ID,
        answers: { q: { type: 'noul', noul: 0.7 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      })
    );
    const client = new TypeSafeSdkJevClient({ apiKey: 'k', fetcher: fetcher as unknown as typeof fetch });
    const result = await client.systemOne({ state: 'hi', questions: QUESTION });
    expect(result.answers.q).toEqual({ type: 'noul', noul: 0.7 });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps auth failures without retrying', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }));
    const client = new TypeSafeSdkJevClient({
      apiKey: 'bad',
      fetcher: fetcher as unknown as typeof fetch,
      maxRetries: 0,
    });
    await expect(client.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps rate-limit and validation errors', async () => {
    const rate = new TypeSafeSdkJevClient({
      apiKey: 'k',
      maxRetries: 0,
      fetcher: (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(rate.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'rate-limit' });

    const bad = new TypeSafeSdkJevClient({
      apiKey: 'k',
      maxRetries: 0,
      fetcher: (async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(bad.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('times out a stalled request', async () => {
    const fetcher = (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = new TypeSafeSdkJevClient({
      apiKey: 'k',
      timeoutMs: 10,
      maxRetries: 0,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'timeout' });
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
    const engine = new JevDecisionEngine({ client: clientReturning(DISPATCH_RESULT) });
    const outcome = await engine.decide({ input: 'pause the music', tools: TOOLS });
    expect(outcome.engine).toBe('jev');
    expect(outcome.calls).toEqual([{ tool: 'media_controls', args: { action: 'pause' } }]);
    expect(outcome.confidence).toBeCloseTo(0.9);
  });

  it('returns no calls when the model picks __none__', async () => {
    const engine = new JevDecisionEngine({
      client: clientReturning({
        model: JEV_MODEL_ID,
        answers: {
          [TOOL_CHOICE_ID]: { type: 'choice', choice: NONE_OPTION, probabilities: { __none__: 0.97 }, confidence: 0.97 },
        },
      }),
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
      client: clientReturning({ model: JEV_MODEL_ID, answers: { speak: { type: 'noul', noul: 0.82 } } }),
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

  const fetchOk = (async () =>
    jsonResponse({
      model: JEV_MODEL_ID,
      answers: DISPATCH_RESULT.answers,
      usage: { input_tokens: 120, output_tokens: 12 },
    })) as unknown as typeof fetch;

  it('decides and audits model typesafe/jev-1.13 with no providerId', async () => {
    const result = await runDecision(
      { getApiKey: async () => null, getJevKey: async () => 'openrouter-key', fetchImpl: fetchOk },
      { config: config('jev'), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'act', outcome: { engine: 'jev' } });
    expect(audit.at(-1)).toMatchObject({
      task: 'intent',
      model: JEV_MODEL_ID,
      outcome: 'ok',
      inputTokens: 120,
      outputTokens: 12,
    });
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
        getJevKey: async () => 'openrouter-key',
        fetchImpl: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
      },
      { config: config('jev'), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'error', engine: 'jev' });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: JEV_MODEL_ID, outcome: 'error' });
  });
});
