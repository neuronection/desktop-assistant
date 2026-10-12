import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMProviderType, type LLMProvider, type Model } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { JEV_MODEL_ID, decisionSlot, type DecisionQuestion, type DecisionToolSchema } from '@shared/ai/decisions';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { runDecision, clearDecisionResolutionCache } from '@main/ai/decide';
import {
  TypeSafeSdkSystemOneClient,
  resolveSystemOneBaseUrl,
  type SystemOneClient,
  type TypeSafeResult,
} from '@main/ai/decide/systemone/client';
import { SystemOneDecisionEngine } from '@main/ai/decide/systemone/engine';
import { buildToolDispatchQuestions, NONE_OPTION, TOOL_CHOICE_ID } from '@main/ai/decide/systemone/projection';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  presetKey: 'openrouter',
  availableModels: [],
  customModels: [],
};

const decisionModel: Model = {
  id: JEV_MODEL_ID,
  name: 'Jev (latest)',
  providerType: provider.type,
  providerId: provider.id,
  caps: ['decision'],
  decisionTransport: 'systemone',
};

const providerWithModel: LLMProvider = {
  ...provider,
  availableModels: [decisionModel],
};

function config(assignments: Record<string, string | null> = {}): AppConfig {
  return mergeWithDefaults({
    providers: [providerWithModel],
    defaultProviderId: providerWithModel.id,
    defaultChatModelId: null,
    taskAssignments: {
      [decisionSlot('tool-dispatch')]: JEV_MODEL_ID,
      ...assignments,
    } as never,
  });
}

function clientReturning(result: TypeSafeResult): SystemOneClient {
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
  model: 'jev-1.13',
  answers: {
    [TOOL_CHOICE_ID]: { type: 'choice', choice: 'media_controls', probabilities: { media_controls: 0.92 }, confidence: 0.92 },
    'media_controls.action': { type: 'choice', choice: 'pause', probabilities: { pause: 0.9 }, confidence: 0.9 },
    'media_controls.shuffle': { type: 'noul', noul: 0.1 },
  },
  usage: { inputTokens: 120, outputTokens: 12 },
};

const QUESTION = { q: { type: 'noul' as const, instructions: 'yes?' } };

describe('System One base URL derivation (plan 26 S1)', () => {
  it('strips a chat-style /v1 segment (OpenRouter)', () => {
    expect(
      resolveSystemOneBaseUrl({ ...provider, apiBase: 'https://openrouter.ai/api/v1' }, decisionModel)
    ).toBe('https://openrouter.ai/api');
  });

  it('keeps a root base as-is (TypeSafe)', () => {
    expect(resolveSystemOneBaseUrl({ ...provider, apiBase: 'https://api.typesafe.ai' }, decisionModel)).toBe(
      'https://api.typesafe.ai'
    );
  });

  it('returns null for an invalid base', () => {
    expect(resolveSystemOneBaseUrl({ ...provider, apiBase: 'not a url' }, decisionModel)).toBeNull();
  });
});

describe('TypeSafe SDK System One client (plan 24 S4 → plan 26 S1)', () => {
  it('maps a systemone response into typed answers', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        model: JEV_MODEL_ID,
        answers: { q: { type: 'noul', noul: 0.7 } },
        usage: { input_tokens: 10, output_tokens: 2 },
      })
    );
    const client = new TypeSafeSdkSystemOneClient({
      apiKey: 'k',
      baseURL: 'https://api.typesafe.ai',
      fetcher: fetcher as unknown as typeof fetch,
    });
    const result = await client.systemOne({ state: 'hi', questions: QUESTION });
    expect(result.answers.q).toEqual({ type: 'noul', noul: 0.7 });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps auth failures without retrying', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }));
    const client = new TypeSafeSdkSystemOneClient({
      apiKey: 'bad',
      baseURL: 'https://api.typesafe.ai',
      maxRetries: 0,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'auth' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('maps rate-limit and validation errors', async () => {
    const rate = new TypeSafeSdkSystemOneClient({
      apiKey: 'k',
      baseURL: 'https://api.typesafe.ai',
      maxRetries: 0,
      fetcher: (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(rate.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'rate-limit' });

    const bad = new TypeSafeSdkSystemOneClient({
      apiKey: 'k',
      baseURL: 'https://api.typesafe.ai',
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
    const client = new TypeSafeSdkSystemOneClient({
      apiKey: 'k',
      baseURL: 'https://api.typesafe.ai',
      timeoutMs: 10,
      maxRetries: 0,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.systemOne({ state: 'x', questions: QUESTION })).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('System One tool-dispatch projection (plan 24 S4)', () => {
  it('asks a __tool__ choice that always carries a __none__ out', () => {
    const questions = buildToolDispatchQuestions(TOOLS);
    const tool = questions[TOOL_CHOICE_ID];
    expect(tool?.type).toBe('choice');
    expect(tool?.type === 'choice' ? Object.keys(tool.criteria) : []).toEqual(['__none__', 'media_controls']);
    expect(questions['media_controls.action']).toMatchObject({ type: 'choice' });
    expect(questions['media_controls.shuffle']).toMatchObject({ type: 'noul' });
  });

  it('grounds catalog args as a Choice over the live entity ids (plan 24 S4b)', () => {
    const grounded: DecisionToolSchema[] = [
      {
        name: 'HassTurnOff',
        description: 'Turn off a device.',
        ...({ appId: 'homeassistant' } as Record<string, unknown>),
        parameters: {
          type: 'object',
          properties: { area: { type: 'string' }, entity_id: { type: 'string' } },
        },
      },
    ];
    const entities = new Map([['homeassistant', ['light.living_room', 'light.office']]]);
    const questions = buildToolDispatchQuestions(grounded, entities);
    const area = questions['HassTurnOff.area'];
    expect(area?.type).toBe('choice');
    expect(Object.keys((area as { criteria: Record<string, unknown> }).criteria)).toEqual([
      'light.living_room',
      'light.office',
    ]);
    expect(questions['HassTurnOff.entity_id']).toMatchObject({ type: 'choice' });
  });

  it('maps answers to a call, dropping low-confidence flags and taking the least-certain confidence', async () => {
    const engine = new SystemOneDecisionEngine({
      apiKey: 'k',
      baseUrl: 'https://api.typesafe.ai',
      model: JEV_MODEL_ID,
      client: clientReturning(DISPATCH_RESULT),
    });
    const outcome = await engine.decide({ input: 'pause the music', tools: TOOLS });
    expect(outcome.engine).toBe(JEV_MODEL_ID);
    expect(outcome.calls).toEqual([{ tool: 'media_controls', args: { action: 'pause' } }]);
    expect(outcome.confidence).toBeCloseTo(0.9);
    expect(outcome.resolvedModel).toBe('jev-1.13');
  });

  it('returns no calls when the model picks __none__', async () => {
    const engine = new SystemOneDecisionEngine({
      apiKey: 'k',
      baseUrl: 'https://api.typesafe.ai',
      model: JEV_MODEL_ID,
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
    const engine = new SystemOneDecisionEngine({
      apiKey: 'k',
      baseUrl: 'https://api.typesafe.ai',
      model: JEV_MODEL_ID,
      client: clientReturning({ model: JEV_MODEL_ID, answers: { speak: { type: 'noul', noul: 0.82 } } }),
    });
    const outcome = await engine.decide({ input: 'read this out loud', tools: [], questions });
    expect(outcome.answers?.speak).toEqual({ type: 'noul', noul: 0.82 });
    expect(outcome.confidence).toBeCloseTo(0.82);
  });
});

describe('System One through the funnel (plan 26 S1)', () => {
  const audit: AiCallRecord[] = [];
  const observed: Array<[string, string]> = [];

  beforeEach(() => {
    audit.length = 0;
    observed.length = 0;
    clearDecisionResolutionCache();
    setAuditSink(async (record) => {
      audit.push(record);
    });
  });

  const fetchOk = (async () =>
    jsonResponse({
      model: 'jev-1.13',
      answers: DISPATCH_RESULT.answers,
      usage: { input_tokens: 120, output_tokens: 12 },
    })) as unknown as typeof fetch;

  it('decides and audits the assigned decision model with providerId + resolved version', async () => {
    const result = await runDecision(
      { getApiKey: async () => 'key', fetchImpl: fetchOk },
      { config: config(), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'act', outcome: { engine: JEV_MODEL_ID } });
    expect(audit.at(-1)).toMatchObject({
      task: 'intent',
      providerId: provider.id,
      model: JEV_MODEL_ID,
      resolvedModel: 'jev-1.13',
      outcome: 'ok',
      inputTokens: 120,
      outputTokens: 12,
    });
  });

  it('records the observed version for the pin affordance (D10)', async () => {
    await runDecision(
      {
        getApiKey: async () => 'key',
        fetchImpl: fetchOk,
        observeResolvedModel: async (modelId, resolved) => {
          observed.push([modelId, resolved]);
        },
      },
      { config: config(), input: 'pause the music', tools: TOOLS }
    );
    expect(observed).toEqual([[JEV_MODEL_ID, 'jev-1.13']]);
  });

  it('is unavailable (needs-key) when the provider row has no key', async () => {
    const result = await runDecision(
      { getApiKey: async () => null },
      { config: config(), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'unavailable', code: 'needs-key', providerId: provider.id });
  });

  it('is off when the slot is unassigned (byte-identical to pre-feature OFF)', async () => {
    const result = await runDecision(
      { getApiKey: async () => 'key' },
      {
        config: mergeWithDefaults({ providers: [providerWithModel], defaultProviderId: providerWithModel.id }),
        input: 'pause the music',
        tools: TOOLS,
      }
    );
    expect(result).toEqual({ status: 'off' });
  });

  it('falls back to the fallback assignment when the primary is unqualified', async () => {
    const cfg = mergeWithDefaults({
      providers: [providerWithModel],
      defaultProviderId: providerWithModel.id,
      taskAssignments: { [decisionSlot('tool-dispatch')]: 'not-a-decision-model' } as never,
      taskFallbackAssignments: { [decisionSlot('tool-dispatch')]: JEV_MODEL_ID },
    });
    const result = await runDecision(
      { getApiKey: async () => 'key', fetchImpl: fetchOk },
      { config: cfg, input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'decided' });
  });

  it('fails open (error status) when the API errors', async () => {
    const result = await runDecision(
      {
        getApiKey: async () => 'key',
        fetchImpl: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
      },
      { config: config(), input: 'pause the music', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'error', transport: 'systemone' });
    expect(audit.at(-1)).toMatchObject({ task: 'intent', model: JEV_MODEL_ID, outcome: 'error' });
  });
});
