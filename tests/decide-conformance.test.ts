import { describe, it, expect, beforeEach } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { runDecision, clearDecisionResolutionCache, type RunDecisionDeps } from '@main/ai/decide';
import { decisionSlot, JEV_MODEL_ID, type DecisionToolSchema } from '@shared/ai/decisions';
import type { TypeSafeResult } from '@main/ai/decide/systemone/client';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test Provider',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' },
    {
      id: JEV_MODEL_ID,
      name: 'Jev (latest)',
      providerType: LLMProviderType.OPENAI,
      providerId: 'provider-1',
      caps: ['decision'],
      decisionTransport: 'systemone',
    },
  ],
  customModels: [],
};

function configWith(): AppConfig {
  return mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    taskAssignments: { [decisionSlot('tool-dispatch')]: JEV_MODEL_ID } as never,
  });
}

const TOOLS: DecisionToolSchema[] = [{ name: 'light_turn_on', description: 'Turn on a light.' }];

/**
 * The conformance suite parameter (plan 26 D9/S1): every shipping transport
 * passes this matrix with its own harness — today that is exactly one,
 * `systemone` (transport mocked via the fetch seam; no network, no keyring).
 * A future transport adds one entry.
 */
interface Harness {
  transport: 'systemone';
  config: AppConfig;
  deps: RunDecisionDeps;
}

const harnesses: Harness[] = [
  {
    transport: 'systemone',
    config: configWith(),
    deps: {
      getApiKey: async () => 'key',
      fetchImpl: (async () => {
        throw new Error('unexpected fetch: conformance runs the mocked transport');
      }) as unknown as typeof fetch,
    },
  },
];

const CALL_RESULT: TypeSafeResult = {
  model: 'jev-1.13',
  answers: {
    __tool__: { type: 'choice', choice: 'light_turn_on', probabilities: { light_turn_on: 0.82 }, confidence: 0.82 },
  },
  usage: { inputTokens: 40, outputTokens: 4 },
};

function okFetch(result: TypeSafeResult): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        ...result,
        usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
      }),
      { status: 200 }
    )) as unknown as typeof fetch;
}

const okFetchRaw = (payload: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;


const audit: AiCallRecord[] = [];

describe('decision transport conformance (plan 24 S1 → plan 26 S1, one transport)', () => {
  beforeEach(() => {
    audit.length = 0;
    clearDecisionResolutionCache();
    setAuditSink(async (record) => {
      audit.push(record);
    });
  });

  it.each(harnesses)('%s: decides with one intent audit row and a bounded confidence', async (harness) => {
    const result = await runDecision(
      { ...harness.deps, fetchImpl: okFetch(CALL_RESULT) },
      { config: harness.config, input: 'dim the living room', tools: TOOLS }
    );
    expect(result.status).toBe('decided');
    if (result.status === 'decided') {
      expect(result.outcome.engine).toBe(JEV_MODEL_ID);
      expect(result.outcome.confidence).toBeGreaterThanOrEqual(0);
      expect(result.outcome.confidence).toBeLessThanOrEqual(1);
      expect(result.outcome.calls.length).toBeGreaterThan(0);
    }
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ task: 'intent', providerId: provider.id, outcome: 'ok' });
  });

  it.each(harnesses)('%s: an empty decision never throws', async (harness) => {
    const result = await runDecision(
      {
        ...harness.deps,
        fetchImpl: okFetchRaw({
          model: JEV_MODEL_ID,
          answers: { __tool__: { type: 'choice', choice: '__none__', probabilities: { __none__: 0.9 }, confidence: 0.9 } },
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      },
      { config: harness.config, input: 'hello there', tools: [] }
    );
    expect(result.status).toBe('decided');
  });

  it.each(harnesses)('%s: bands low confidence as refuse (fall-through contract)', async (harness) => {
    const result = await runDecision(
      {
        ...harness.deps,
        fetchImpl: okFetchRaw({
          model: JEV_MODEL_ID,
          answers: { __tool__: { type: 'choice', choice: 'light_turn_on', probabilities: { light_turn_on: 0.3 }, confidence: 0.3 } },
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      },
      { config: harness.config, input: 'maybe lights?', tools: TOOLS }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'refuse' });
  });

  it.each(harnesses)('%s: transport failure audits an error row and fails open', async (harness) => {
    const result = await runDecision(
      {
        ...harness.deps,
        fetchImpl: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
      },
      { config: harness.config, input: 'dim the living room', tools: TOOLS }
    );
    expect(result.status).toBe('error');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ task: 'intent', outcome: 'error' });
  });

  it('the conformance parameter stays honest: exactly one transport ships', () => {
    expect(harnesses).toHaveLength(1);
    expect(harnesses[0].transport).toBe('systemone');
  });
});

