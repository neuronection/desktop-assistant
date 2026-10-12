import { describe, it, expect, beforeEach } from 'vitest';
import type { LLMProvider, Model } from '@shared/types';
import { LLMProviderType } from '@shared/types';
import { DEFAULT_CONFIG, mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import {
  DECISION_ACT_THRESHOLD_DEFAULT,
  DECISION_CONFIRM_THRESHOLD_DEFAULT,
  DECISION_SLOTS,
  decisionBand,
  decisionSlot,
  decisionSlotCapability,
  mergeDecisionSettings,
} from '@shared/ai/decisions';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask } from '@shared/types';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import {
  clearDecisionResolutionCache,
  resolveDecision,
  runDecision,
} from '@main/ai/decide';

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

const decisionOnlyProvider: LLMProvider = {
  id: 'provider-decision',
  name: 'TypeSafe',
  type: LLMProviderType.DECISION,
  apiKey: '',
  apiBase: 'https://api.typesafe.ai',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  presetKey: 'typesafe',
  availableModels: [
    { id: 'jev-latest', name: 'Jev (latest)', providerType: LLMProviderType.DECISION, providerId: 'provider-decision', caps: ['decision'] },
  ],
  customModels: [],
};

function configWith(overrides: Partial<AppConfig> = {}): AppConfig {
  return mergeWithDefaults({
    ...overrides,
    providers: [provider],
    defaultProviderId: provider.id,
    defaultChatModelId: 'model-mini',
  });
}

function decisionConfig(assignments: Record<string, string | null>, providers: LLMProvider[] = [provider]): AppConfig {
  return mergeWithDefaults({
    providers,
    defaultProviderId: providers[0]?.id ?? null,
    defaultChatModelId: null,
    taskAssignments: assignments as never,
  });
}

describe('mergeDecisionSettings', () => {
  it('defaults to family thresholds with empty observed versions', () => {
    const settings = mergeDecisionSettings(undefined);
    expect(settings.actThreshold).toBe(DECISION_ACT_THRESHOLD_DEFAULT);
    expect(settings.confirmThreshold).toBe(DECISION_CONFIRM_THRESHOLD_DEFAULT);
    expect(settings.scope).toEqual({ apps: [], includeNatives: false });
    expect(settings.routeTools).toEqual([]);
    expect(settings.prompt).toBe('');
    expect(settings.observedVersions).toEqual({});
    expect(settings.legacyEngineNotice).toBeUndefined();
  });

  it('sanitizes non-finite thresholds', () => {
    const settings = mergeDecisionSettings({ actThreshold: Number.NaN, confirmThreshold: 'high' as never });
    expect(settings.actThreshold).toBe(DECISION_ACT_THRESHOLD_DEFAULT);
    expect(settings.confirmThreshold).toBe(DECISION_CONFIRM_THRESHOLD_DEFAULT);
  });

  it('keeps act above confirm when inverted', () => {
    const settings = mergeDecisionSettings({ actThreshold: 0.4, confirmThreshold: 0.9 });
    expect(settings.actThreshold).toBeGreaterThanOrEqual(settings.confirmThreshold);
  });

  it('sanitizes observed versions (D10) and the legacy notice flag', () => {
    const settings = mergeDecisionSettings({
      observedVersions: { 'jev-latest': 'jev-1.13', bad: 42 as never, '': 'x' },
      legacyEngineNotice: true,
    });
    expect(settings.observedVersions).toEqual({ 'jev-latest': 'jev-1.13' });
    expect(settings.legacyEngineNotice).toBe(true);
    expect(mergeDecisionSettings({ observedVersions: { m: ' v ' } }).observedVersions).toEqual({ m: 'v' });
  });

  it('sanitizes route tools: name pattern, uniqueness, caps (D10)', () => {
    const settings = mergeDecisionSettings({
      routeTools: [
        { name: 'ask_gemini', description: 'Route hard questions to Gemini.', modelId: 'gemini-pro', examples: ['what is the capital of France'] },
        { name: 'Bad Name', description: 'invalid name', modelId: 'm' },
        { name: 'ask_gemini', description: 'duplicate', modelId: 'm' },
        { name: 'no_model', description: 'missing model', modelId: '' },
        { name: 'no_description', description: '   ', modelId: 'm' },
        { name: 'capped', description: 'y'.repeat(400), modelId: 'm', examples: ['z'.repeat(300), ...Array.from({ length: 9 }, (_, i) => `example ${i}`)] },
      ],
    });
    expect(settings.routeTools.map((tool) => tool.name)).toEqual(['ask_gemini', 'capped']);
    const capped = settings.routeTools[1];
    expect(capped?.description).toHaveLength(240);
    expect(capped?.examples).toHaveLength(6);
    expect(capped?.examples?.[0]).toHaveLength(120);
  });

  it('trims and caps the user prompt (D11)', () => {
    const settings = mergeDecisionSettings({ prompt: `  ${'x'.repeat(1200)}  ` });
    expect(settings.prompt).toHaveLength(1000);
    expect(settings.prompt.startsWith('x')).toBe(true);
  });

  it('sanitizes scope app ids and defaults includeNatives to false (D8, user-approved flip)', () => {
    const settings = mergeDecisionSettings({ scope: { apps: ['ha', 'ha', ' ', 42 as never], includeNatives: false } });
    expect(settings.scope).toEqual({ apps: ['ha'], includeNatives: false });
    expect(mergeDecisionSettings({ scope: undefined }).scope.includeNatives).toBe(false);
    expect(mergeDecisionSettings({ scope: { apps: [], includeNatives: true } }).scope.includeNatives).toBe(true);
  });
});

describe('decisionBand', () => {
  const settings = mergeDecisionSettings({});

  it('bands act at and above the act threshold', () => {
    expect(decisionBand(1, settings)).toBe('act');
    expect(decisionBand(settings.actThreshold, settings)).toBe('act');
  });

  it('bands confirm between thresholds and refuse below', () => {
    expect(decisionBand(settings.confirmThreshold, settings)).toBe('confirm');
    expect(decisionBand(0.6, settings)).toBe('confirm');
    expect(decisionBand(0.49, settings)).toBe('refuse');
    expect(decisionBand(0, settings)).toBe('refuse');
  });
});

describe('decision slots vocabulary (plan 26 D3/D2b)', () => {
  it('exposes exactly the four assignable slots — open-args is reserved', () => {
    expect(DECISION_SLOTS).toEqual([
      'decision:tool-dispatch',
      'decision:boolean-gate',
      'decision:choice',
      'decision:score',
    ]);
    expect(DECISION_SLOTS).not.toContain('decision:open-args');
  });

  it('maps slots to capabilities and rejects reserved/unknown keys', () => {
    expect(decisionSlotCapability('decision:tool-dispatch')).toBe('tool-dispatch');
    expect(decisionSlotCapability('decision:open-args')).toBeNull();
    expect(decisionSlotCapability('chat')).toBeNull();
  });
});

describe('config integration', () => {
  it('no decision slot is assigned by default (byte-identical OFF)', () => {
    const config = mergeWithDefaults({});
    for (const slot of DECISION_SLOTS) {
      expect(config.taskAssignments[slot]).toBeUndefined();
    }
    expect(config.taskFallbackAssignments).toEqual({});
    expect('intent' in config.taskAssignments).toBe(false);
  });

  it('drops the retired intent assignment and unknown keys outright (no legacy reads)', () => {
    const config = mergeWithDefaults({
      taskAssignments: { intent: 'model-mini', bogus: 'x', chat: 'model-mini' } as never,
      taskFallbackAssignments: { 'decision:tool-dispatch': 'jev-latest', bogus: 'y' } as never,
    });
    expect(config.taskAssignments[AiTask.CHAT]).toBe('model-mini');
    expect('intent' in config.taskAssignments).toBe(false);
    expect('bogus' in config.taskAssignments).toBe(false);
    expect(config.taskFallbackAssignments).toEqual({ 'decision:tool-dispatch': 'jev-latest' });
    expect('bogus' in config.taskFallbackAssignments).toBe(false);
  });

  it('round-trips decision slots and fallbacks through mergeWithDefaults', () => {
    const config = mergeWithDefaults({
      providers: [provider],
      taskAssignments: { 'decision:tool-dispatch': 'jev-latest' } as never,
      taskFallbackAssignments: { 'decision:choice': 'jev-latest' } as never,
    });
    expect(config.taskAssignments['decision:tool-dispatch']).toBe('jev-latest');
    expect(config.taskFallbackAssignments['decision:choice']).toBe('jev-latest');
  });

  it('round-trips scope, route tools, prompt and observed versions (S7a/D10)', () => {
    const config = mergeWithDefaults({
      decision: {
        scope: { apps: ['homeassistant'], includeNatives: false },
        routeTools: [{ name: 'ask_gemini', description: 'Route to Gemini.', modelId: 'gemini-pro' }],
        prompt: 'Prefer exact entity names.',
        observedVersions: { 'jev-latest': 'jev-1.13' },
      },
    });
    expect(config.decision.scope).toEqual({ apps: ['homeassistant'], includeNatives: false });
    expect(config.decision.routeTools).toEqual([{ name: 'ask_gemini', description: 'Route to Gemini.', modelId: 'gemini-pro' }]);
    expect(config.decision.prompt).toBe('Prefer exact entity names.');
    expect(config.decision.observedVersions).toEqual({ 'jev-latest': 'jev-1.13' });
  });

  it('DEFAULT_CONFIG carries no decision slots and no intent assignment', () => {
    expect(DEFAULT_CONFIG.taskAssignments.intent).toBeUndefined();
    expect(Object.keys(DEFAULT_CONFIG.taskAssignments)).not.toContain('decision:tool-dispatch');
  });
});

describe('slot separation (plan 26 D4, enforced both directions)', () => {
  it('a decision-cap model never satisfies a chat task', () => {
    const config = decisionConfig({ chat: 'jev-latest' } as never);
    expect(resolveTaskModel(config, AiTask.CHAT)).toBeNull();
  });

  it('a decision-only provider never serves a chat task', () => {
    const config = decisionConfig({ chat: 'jev-latest' }, [decisionOnlyProvider]);
    expect(resolveTaskModel(config, AiTask.CHAT)).toBeNull();
  });

  it('a text model never satisfies a decision slot', async () => {
    const resolution = await resolveDecision('tool-dispatch', decisionConfig({ [decisionSlot('tool-dispatch')]: 'model-mini' }), {
      getApiKey: async () => 'key',
    });
    expect(resolution).toMatchObject({ kind: 'unconfigured' });
  });

  it('a model row without the transport seam is rejected even with a decision cap', async () => {
    const unseamed: LLMProvider = {
      ...provider,
      availableModels: [
        { id: 'model-mini', name: 'Mini', providerType: LLMProviderType.OPENAI, providerId: provider.id },
        {
          id: 'jev-fake',
          name: 'Fake decision row',
          providerType: LLMProviderType.OPENAI,
          providerId: provider.id,
          caps: ['decision'],
        },
      ],
    };
    const resolution = await resolveDecision('tool-dispatch', decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-fake' }, [unseamed]), {
      getApiKey: async () => 'key',
    });
    expect(resolution).toMatchObject({ kind: 'unconfigured' });
  });
});

describe('resolveDecision (plan 26 D6)', () => {
  beforeEach(() => {
    clearDecisionResolutionCache();
  });

  it('resolves off when the slot is unassigned', async () => {
    const resolution = await resolveDecision('tool-dispatch', configWith(), { getApiKey: async () => null });
    expect(resolution.kind).toBe('off');
  });

  it('resolves off for the reserved open-args capability (never assignable)', async () => {
    const resolution = await resolveDecision('open-args', configWith(), { getApiKey: async () => null });
    expect(resolution.kind).toBe('off');
  });

  it('resolves the assigned model → provider row with the derived base URL', async () => {
    const resolution = await resolveDecision(
      'tool-dispatch',
      decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
      { getApiKey: async () => 'key' }
    );
    expect(resolution).toMatchObject({
      kind: 'systemone',
      provider: { id: provider.id },
      apiKey: 'key',
    });
    if (resolution.kind === 'systemone') {
      expect(resolution.model.id).toBe('jev-latest');
      expect(resolution.baseUrl).toBe('https://api.example.com');
    }
  });

  it('a decision-only provider implies the systemone transport', async () => {
    const resolution = await resolveDecision(
      'choice',
      decisionConfig({ [decisionSlot('choice')]: 'jev-latest' }, [decisionOnlyProvider]),
      { getApiKey: async () => 'key' }
    );
    expect(resolution).toMatchObject({ kind: 'systemone', baseUrl: 'https://api.typesafe.ai' });
  });

  it('reports needs-key when the provider row has no key (D8 secret ids)', async () => {
    const resolution = await resolveDecision(
      'tool-dispatch',
      decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
      { getApiKey: async () => null }
    );
    expect(resolution).toMatchObject({
      kind: 'unavailable',
      code: 'needs-key',
      providerId: provider.id,
    });
  });

  it('falls back to the fallback assignment when the primary is dead', async () => {
    const resolution = await resolveDecision(
      'tool-dispatch',
      mergeWithDefaults({
        providers: [provider],
        defaultProviderId: provider.id,
        taskAssignments: { [decisionSlot('tool-dispatch')]: 'gone-model' } as never,
        taskFallbackAssignments: { [decisionSlot('tool-dispatch')]: 'jev-latest' } as never,
      }),
      { getApiKey: async () => 'key' }
    );
    expect(resolution).toMatchObject({ kind: 'systemone' });
  });

  it('caches resolution per config revision (voice hot path)', async () => {
    const calls: string[] = [];
    let revision = 7;
    const deps = {
      getApiKey: async (_provider: LLMProvider) => {
        calls.push('key');
        return 'key';
      },
      configRevision: () => revision,
    };
    const config = decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' });
    const first = await resolveDecision('tool-dispatch', config, deps);
    const second = await resolveDecision('tool-dispatch', config, deps);
    expect(first).toEqual(second);
    expect(calls).toHaveLength(1);
    revision = 8;
    const third = await resolveDecision('tool-dispatch', config, deps);
    expect(third).toMatchObject({ kind: 'systemone' });
    expect(calls).toHaveLength(2);
  });
});

describe('runDecision funnel (plan 26 S1)', () => {
  const audit: AiCallRecord[] = [];

  beforeEach(() => {
    audit.length = 0;
    clearDecisionResolutionCache();
    setAuditSink(async (record) => {
      audit.push(record);
    });
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

  it('audits ok rows with task intent, providerId and the resolved version', async () => {
    const result = await runDecision(
      { getApiKey: async () => 'key', fetchImpl: okFetch },
      {
        config: decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
        input: 'dim the living room to 30',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result.status).toBe('decided');
    if (result.status === 'decided') {
      expect(result.band).toBe('act');
      expect(result.outcome.calls[0]?.tool).toBe('light_turn_on');
      expect(result.outcome.engine).toBe('jev-latest');
    }
    expect(audit.at(-1)).toMatchObject({
      task: 'intent',
      providerId: 'provider-1',
      model: 'jev-latest',
      resolvedModel: 'jev-1.13',
      outcome: 'ok',
    });
  });

  it('returns error status with an audited failure on provider errors', async () => {
    const result = await runDecision(
      {
        getApiKey: async () => 'key',
        fetchImpl: (async () => new Response('bad', { status: 400 })) as unknown as typeof fetch,
      },
      {
        config: decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
        input: 'dim the living room',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result.status).toBe('error');
    expect(audit.at(-1)).toMatchObject({ task: 'intent', outcome: 'error' });
  });

  it('off and unavailable paths never audit', async () => {
    const before = audit.length;
    const off = await runDecision({ getApiKey: async () => 'key' }, {
      config: configWith(),
      input: 'x',
      tools: [],
    });
    const unavailable = await runDecision({ getApiKey: async () => null }, {
      config: decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
      input: 'x',
      tools: [],
    });
    expect(off.status).toBe('off');
    expect(unavailable.status).toBe('unavailable');
    expect(audit.length).toBe(before);
  });

  it('bands low confidence as refuse (fall-through contract)', async () => {
    const result = await runDecision(
      {
        getApiKey: async () => 'key',
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({
              model: 'jev-1.13',
              answers: {
                __tool__: { type: 'choice', choice: 'light_turn_on', probabilities: { light_turn_on: 0.3 }, confidence: 0.3 },
              },
              usage: { input_tokens: 5, output_tokens: 1 },
            }),
            { status: 200 }
          )) as unknown as typeof fetch,
      },
      {
        config: decisionConfig({ [decisionSlot('tool-dispatch')]: 'jev-latest' }),
        input: 'maybe lights?',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'refuse' });
  });
});

describe('model registry invariants (plan 26 S2b)', () => {
  it('decision model rows carry the sparse decision cap and the transport seam', () => {
    const decisionRows: Model[] = [];
    for (const candidate of [...provider.availableModels, ...decisionOnlyProvider.availableModels]) {
      if ((candidate.caps ?? []).includes('decision')) {
        decisionRows.push(candidate);
      }
    }
    expect(decisionRows).toHaveLength(2);
    for (const row of decisionRows) {
      expect(row.caps).toEqual(['decision']);
    }
  });
});
