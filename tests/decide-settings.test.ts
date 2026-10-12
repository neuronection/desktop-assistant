import { describe, it, expect, beforeEach } from 'vitest';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { setAuditSink } from '@main/ai/audit';
import { DecisionSettingsController, type DecisionSettingsDeps } from '@main/ai/decide/settings-controller';
import { clearDecisionResolutionCache } from '@main/ai/decide';
import { decisionSlot } from '@shared/ai/decisions';

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
  availableModels: [
    { id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' },
    {
      id: 'jev-latest',
      name: 'Jev (latest)',
      providerType: LLMProviderType.OPENAI,
      providerId: 'provider-1',
      caps: ['decision'],
      decisionTransport: 'systemone',
    },
  ],
  customModels: [],
};

const config = (assignments: Record<string, string | null> = {}): AppConfig =>
  mergeWithDefaults({
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
    taskAssignments: assignments as never,
  });

const okFetch = (async () =>
  new Response(
    JSON.stringify({
      model: 'jev-1.13',
      answers: {
        __tool__: { type: 'choice', choice: 'light_turn_on', probabilities: { light_turn_on: 0.95 }, confidence: 0.95 },
      },
      usage: { input_tokens: 20, output_tokens: 2 },
    }),
    { status: 200 }
  )) as unknown as typeof fetch;

describe('DecisionSettingsController (plan 26 S1)', () => {
  beforeEach(() => {
    setAuditSink(async () => undefined);
    clearDecisionResolutionCache();
  });

  const deps = (overrides: Partial<DecisionSettingsDeps> = {}): DecisionSettingsDeps => ({
    config: () => config({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
    getApiKey: async () => 'key',
    ...overrides,
  });

  it('reports per-slot status with assigned + fallback ids (plan 24 S2 shape)', async () => {
    const controller = new DecisionSettingsController(
      deps({
        config: () =>
          config({ [decisionSlot('tool-dispatch')]: 'jev-latest', [decisionSlot('choice')]: 'jev-latest' }),
      })
    );
    const state = await controller.getState();
    expect(state.slots).toHaveLength(4);
    const dispatch = state.slots.find((slot) => slot.capability === 'tool-dispatch');
    expect(dispatch).toMatchObject({
      slot: 'decision:tool-dispatch',
      transport: 'systemone',
      assignedModelId: 'jev-latest',
      readiness: { state: 'ready' },
    });
    const gate = state.slots.find((slot) => slot.capability === 'boolean-gate');
    expect(gate?.assignedModelId).toBeNull();
    expect(gate?.readiness.state).toBe('unavailable');
  });

  it('marks a slot needs-key when the provider row has no key', async () => {
    const controller = new DecisionSettingsController(
      deps({ config: () => config({ [decisionSlot('boolean-gate')]: 'jev-latest' }), getApiKey: async () => null })
    );
    const state = await controller.getState();
    const gate = state.slots.find((slot) => slot.capability === 'boolean-gate');
    expect(gate?.readiness).toEqual({ state: 'needs-key', secretId: `provider:${provider.id}` });
  });

  it('runs the decision test through the funnel', async () => {
    const controller = new DecisionSettingsController(deps({ fetchImpl: okFetch }));
    const test = await controller.test('dim the living room');
    expect(test.result).toMatchObject({
      status: 'decided',
      engine: 'jev-latest',
      confidence: 0.95,
      band: 'act',
      calls: [{ tool: 'light_turn_on' }],
    });
    expect(test.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports the custom rule a decision would fire (plan 24 S7 dry-run)', async () => {
    const cfg = config({ [decisionSlot('tool-dispatch')]: 'jev-latest' });
    cfg.decision.rules = [{ id: 'r1', enabled: true, matchTool: 'light_turn_on', action: 'notify', text: 'Lights on' }];
    const controller = new DecisionSettingsController(deps({ config: () => cfg, fetchImpl: okFetch }));
    const test = await controller.test('dim the living room');
    expect(test.result).toMatchObject({ status: 'decided', calls: [{ tool: 'light_turn_on' }] });
    expect(test.rule).toEqual({ id: 'r1', action: 'notify', text: 'Lights on' });
  });

  it('reports off when no slot is assigned', async () => {
    const controller = new DecisionSettingsController(deps({ config: () => config() }));
    const test = await controller.test('dim the living room');
    expect(test.result).toEqual({ status: 'off' });
  });
});
