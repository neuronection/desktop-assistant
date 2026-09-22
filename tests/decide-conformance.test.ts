import { describe, it, expect, beforeEach } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { runDecision, type RunDecisionDeps } from '@main/ai/decide';
import type { DecisionEngineKind, DecisionToolSchema } from '@shared/ai/decisions';
import type { NeedleTransport } from '@main/ai/decide/needle/transport';
import type { StructuredModelFactory } from '@main/ai/chat-models';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test Provider',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    { id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' },
  ],
  customModels: [],
};

function configWith(engine: DecisionEngineKind): AppConfig {
  return mergeWithDefaults({
    defaultChatModelId: 'model-mini',
    providers: [provider],
    defaultProviderId: provider.id,
    decision: { engine, actThreshold: 0.85, confirmThreshold: 0.5 },
  });
}

const TOOLS: DecisionToolSchema[] = [{ name: 'light_turn_on', description: 'Turn on a light.' }];

interface Harness {
  name: DecisionEngineKind;
  config: AppConfig;
  deps: RunDecisionDeps;
}

function llmHarness(invoke: () => Promise<unknown>): Harness {
  const createStructuredModel: StructuredModelFactory = () => ({ invoke: invoke as never });
  return { name: 'llm', config: configWith('llm'), deps: { getApiKey: async () => 'key', createStructuredModel } };
}

function needleWire(calls: { name: string; arguments: Record<string, unknown> }[], confidence: number): string {
  return JSON.stringify({
    type: 'call',
    success: true,
    function_calls: calls,
    suppressed_calls: [],
    reasoning: 'conformance',
    confidence,
  });
}

function fakeNeedleTransport(output: string): NeedleTransport {
  return {
    load: async () => undefined,
    init: async () => undefined,
    complete: async () => output,
    reset: async () => undefined,
    dispose: () => undefined,
  };
}

function needleHarness(output: string): Harness {
  return {
    name: 'needle',
    config: configWith('needle'),
    deps: {
      getApiKey: async () => null,
      needle: {
        userDataDir: async () => '/tmp/decide-conformance',
        resourceDir: async () => '/resources/needle',
        createTransport: () => fakeNeedleTransport(output),
        locateWeights: async () => '/tmp/decide-conformance/needle3.cact',
      },
    },
  };
}

const CALL = { name: 'light_turn_on', arguments: { entity_id: 'light.living_room' } };

const engines: [DecisionEngineKind, Harness][] = [
  ['llm', llmHarness(async () => ({ calls: [{ tool: 'light_turn_on', args: {} }], confidence: 0.95 }))],
  ['needle', needleHarness(needleWire([CALL], 0.82))],
];

const emptyEngines: [DecisionEngineKind, Harness][] = [
  ['llm', llmHarness(async () => ({ calls: [], confidence: 0.9 }))],
  ['needle', needleHarness(needleWire([], 0.9))],
];

const lowEngines: [DecisionEngineKind, Harness][] = [
  ['llm', llmHarness(async () => ({ calls: [{ tool: 'light_turn_on', args: {} }], confidence: 0.3 }))],
  ['needle', needleHarness(needleWire([CALL], 0.3))],
];

const errorEngines: [DecisionEngineKind, Harness][] = [
  [
    'llm',
    llmHarness(async () => {
      throw new Error('model exploded');
    }),
  ],
  ['needle', needleHarness('{ not json')],
];

const audit: AiCallRecord[] = [];

describe('decision engine conformance (plan 24 S1)', () => {
  beforeEach(() => {
    audit.length = 0;
    setAuditSink(async (record) => {
      audit.push(record);
    });
  });

  it.each(engines)('%s: decides with one intent audit row and a bounded confidence', async (kind, harness) => {
    const result = await runDecision(harness.deps, { config: harness.config, input: 'dim the living room', tools: TOOLS });
    expect(result.status).toBe('decided');
    if (result.status === 'decided') {
      expect(result.outcome.engine).toBe(kind);
      expect(result.outcome.confidence).toBeGreaterThanOrEqual(0);
      expect(result.outcome.confidence).toBeLessThanOrEqual(1);
      expect(result.outcome.calls.length).toBeGreaterThan(0);
    }
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ task: 'intent', outcome: 'ok' });
  });

  it.each(emptyEngines)('%s: an empty decision never throws', async (_kind, harness) => {
    const result = await runDecision(harness.deps, { config: harness.config, input: 'hello there', tools: [] });
    expect(result.status).toBe('decided');
  });

  it.each(lowEngines)('%s: bands low confidence as refuse (fall-through contract)', async (_kind, harness) => {
    const result = await runDecision(harness.deps, { config: harness.config, input: 'maybe lights?', tools: TOOLS });
    expect(result).toMatchObject({ status: 'decided', band: 'refuse' });
  });

  it.each(errorEngines)('%s: engine failure audits an error row and fails open', async (_kind, harness) => {
    const result = await runDecision(harness.deps, { config: harness.config, input: 'dim the living room', tools: TOOLS });
    expect(result.status).toBe('error');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ task: 'intent', outcome: 'error' });
  });
});
