import { describe, it, expect } from 'vitest';
import type { LLMProvider } from '@shared/types';
import { LLMProviderType } from '@shared/types';
import { DEFAULT_CONFIG, mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import {
  DECISION_ACT_THRESHOLD_DEFAULT,
  DECISION_CONFIRM_THRESHOLD_DEFAULT,
  decisionBand,
  mergeDecisionSettings,
} from '@shared/ai/decisions';
import { setAuditSink, type AiCallRecord } from '@main/ai/audit';
import { buildDecisionMessages, renderToolCatalog, toOutcome } from '@main/ai/decide/llm';
import { resolveDecisionEngine, resolveDecisionEngineAsync, runDecision } from '@main/ai/decide';
import type { StructuredModelFactory } from '@main/ai/chat-models';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  availableModels: [{ id: 'model-mini', name: 'Model Mini', providerType: LLMProviderType.OPENAI, providerId: 'provider-1' }],
  customModels: [],
};

function configWith(overrides: Partial<AppConfig>): AppConfig {
  return mergeWithDefaults({
    defaultChatModelId: 'model-mini',
    ...overrides,
    providers: [provider],
    defaultProviderId: provider.id,
  });
}

describe('mergeDecisionSettings', () => {
  it('defaults to off with family thresholds', () => {
    const settings = mergeDecisionSettings(undefined);
    expect(settings.engine).toBe('off');
    expect(settings.actThreshold).toBe(DECISION_ACT_THRESHOLD_DEFAULT);
    expect(settings.confirmThreshold).toBe(DECISION_CONFIRM_THRESHOLD_DEFAULT);
    expect(settings.scope).toEqual({ apps: [], includeNatives: false });
    expect(settings.routeTools).toEqual([]);
    expect(settings.prompt).toBe('');
  });

  it('sanitizes unknown engines and non-finite thresholds', () => {
    const settings = mergeDecisionSettings({ engine: 'jev' as never, actThreshold: Number.NaN, confirmThreshold: 'high' as never });
    expect(settings.engine).toBe('off');
    expect(settings.actThreshold).toBe(DECISION_ACT_THRESHOLD_DEFAULT);
    expect(settings.confirmThreshold).toBe(DECISION_CONFIRM_THRESHOLD_DEFAULT);
  });

  it('keeps act above confirm when inverted', () => {
    const settings = mergeDecisionSettings({ engine: 'llm', actThreshold: 0.4, confirmThreshold: 0.9 });
    expect(settings.actThreshold).toBeGreaterThanOrEqual(settings.confirmThreshold);
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
  const settings = mergeDecisionSettings({ engine: 'llm' });

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

describe('config integration', () => {
  it('OFF is the merged default (D1 parity)', () => {
    const config = mergeWithDefaults({});
    expect(config.decision.engine).toBe('off');
    expect(DEFAULT_CONFIG.taskAssignments.intent).toBeNull();
  });

  it('round-trips user settings through mergeWithDefaults', () => {
    const config = mergeWithDefaults({ decision: { engine: 'llm', actThreshold: 0.9, confirmThreshold: 0.6 } });
    expect(config.decision.engine).toBe('llm');
    expect(config.decision.actThreshold).toBe(0.9);
    expect(config.decision.confirmThreshold).toBe(0.6);
  });

  it('round-trips scope, route tools and prompt through mergeWithDefaults (S7a)', () => {
    const config = mergeWithDefaults({
      decision: {
        engine: 'needle',
        scope: { apps: ['homeassistant'], includeNatives: false },
        routeTools: [{ name: 'ask_gemini', description: 'Route to Gemini.', modelId: 'gemini-pro' }],
        prompt: 'Prefer exact entity names.',
      },
    });
    expect(config.decision.scope).toEqual({ apps: ['homeassistant'], includeNatives: false });
    expect(config.decision.routeTools).toEqual([{ name: 'ask_gemini', description: 'Route to Gemini.', modelId: 'gemini-pro' }]);
    expect(config.decision.prompt).toBe('Prefer exact entity names.');
  });
});

describe('llm engine', () => {
  it('renders a compact one-line-per-tool catalog', () => {
    const catalog = renderToolCatalog([
      { name: 'light_turn_on', description: 'Turn on a light.', parameters: { type: 'object' } },
      { name: 'light_turn_off', description: 'Turn off a light.' },
    ]);
    expect(catalog.split('\n')).toHaveLength(2);
    expect(catalog).toContain('"name":"light_turn_on"');
  });

  it('builds system + catalog + user messages', () => {
    const messages = buildDecisionMessages({ input: 'dim the living room', tools: [{ name: 'light_turn_on', description: 'd' }] });
    expect(messages).toHaveLength(3);
    expect(messages[1].content).toContain('Tool catalog:');
  });

  it('normalizes output: defaults calls, sanitizes confidence', () => {
    const outcome = toOutcome({ confidence: 1.7, calls: [{ tool: 'light_turn_on', args: {} }] });
    expect(outcome.engine).toBe('llm');
    expect(outcome.confidence).toBe(1);
    expect(outcome.calls).toEqual([{ tool: 'light_turn_on', args: {} }]);
  });
});

describe('resolveDecisionEngine', () => {
  it('resolves off without touching providers', () => {
    const resolution = resolveDecisionEngine(mergeDecisionSettings({ engine: 'off' }), configWith({}), {});
    expect(resolution.kind).toBe('off');
  });

  it('needle is typed-unavailable without downloaded weights', async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'decide-s1-'));
    const resolution = await resolveDecisionEngineAsync(
      mergeDecisionSettings({ engine: 'needle' }),
      configWith({}),
      {
        getApiKey: async () => null,
        needle: { userDataDir: async () => userDataDir, resourceDir: async () => '/nonexistent' },
      }
    );
    expect(resolution).toMatchObject({ kind: 'unavailable' });
  });

  it('falls back to the chat model when no intent model is assigned', () => {
    const config = configWith({
      defaultChatModelId: 'model-mini',
      taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, intent: null },
    });
    const resolution = resolveDecisionEngine(mergeDecisionSettings({ engine: 'llm' }), config, {});
    expect(resolution).toMatchObject({ kind: 'llm-engine', modelId: 'model-mini' });
  });

  it('reports unconfigured when no model exists at all', () => {
    const empty = mergeWithDefaults({ providers: [], defaultProviderId: null, defaultChatModelId: null });
    const resolution = resolveDecisionEngine(mergeDecisionSettings({ engine: 'llm' }), empty, {});
    expect(resolution).toMatchObject({ kind: 'unconfigured' });
  });
});

describe('runDecision funnel', () => {
  const audit: AiCallRecord[] = [];

  it('audits ok rows with task intent and bands the confidence', async () => {
    setAuditSink(async (record) => {
      audit.push(record);
    });
    const createModel: StructuredModelFactory = (_provider, _modelId, _apiKey, _schema, overrides) => {
      expect(overrides?.temperature).toBe(0);
      return {
        invoke: async () => ({
          calls: [{ tool: 'light_turn_on', args: { entity_id: 'light.living_room', brightness_pct: 30 } }],
          confidence: 0.95,
          reasoning: 'direct dim request',
        }),
      };
    };
    const result = await runDecision(
      { getApiKey: async () => 'key', createStructuredModel: createModel },
      {
        config: configWith({ decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 } }),
        input: 'dim the living room to 30',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result.status).toBe('decided');
    if (result.status === 'decided') {
      expect(result.band).toBe('act');
      expect(result.outcome.calls[0]?.tool).toBe('light_turn_on');
    }
    expect(audit.at(-1)).toMatchObject({ task: 'intent', providerId: 'provider-1', model: 'model-mini', outcome: 'ok' });
  });

  it('returns error status with an audited failure on invalid model output', async () => {
    const before = audit.length;
    const createModel: StructuredModelFactory = () => ({ invoke: async () => ({ calls: 'nope' }) });
    const result = await runDecision(
      { getApiKey: async () => 'key', createStructuredModel: createModel },
      {
        config: configWith({ decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 } }),
        input: 'dim the living room',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result.status).toBe('error');
    expect(audit.length).toBe(before + 1);
    expect(audit.at(-1)).toMatchObject({ task: 'intent', outcome: 'error' });
  });

  it('off and unavailable paths never audit', async () => {
    const before = audit.length;
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'decide-s1-'));
    const needle = { userDataDir: async () => userDataDir, resourceDir: async () => '/nonexistent' };
    const off = await runDecision({ getApiKey: async () => null }, {
      config: configWith({}),
      input: 'x',
      tools: [],
    });
    const needleResult = await runDecision({ getApiKey: async () => null, needle }, {
      config: configWith({ decision: { engine: 'needle', actThreshold: 0.85, confirmThreshold: 0.5 } }),
      input: 'x',
      tools: [],
    });
    expect(off.status).toBe('off');
    expect(needleResult.status).toBe('unavailable');
    expect(audit.length).toBe(before);
  });

  it('bands low confidence as refuse (fall-through contract)', async () => {
    const createModel: StructuredModelFactory = () => ({
      invoke: async () => ({ calls: [{ tool: 'light_turn_on', args: {} }], confidence: 0.3 }),
    });
    const result = await runDecision(
      { getApiKey: async () => 'key', createStructuredModel: createModel },
      {
        config: configWith({ decision: { engine: 'llm', actThreshold: 0.85, confirmThreshold: 0.5 } }),
        input: 'maybe lights?',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(result).toMatchObject({ status: 'decided', band: 'refuse' });
  });

  it('threads the assembled prompt to the engine when none is given (S7a D11)', async () => {
    let systemText = '';
    const createModel: StructuredModelFactory = () => ({
      invoke: async (messages: { content: string }[]) => {
        systemText = String(messages[0]?.content ?? '');
        return { calls: [], confidence: 0.9 };
      },
    });
    await runDecision(
      { getApiKey: async () => 'key', createStructuredModel: createModel },
      {
        config: configWith({
          decision: {
            engine: 'llm',
            actThreshold: 0.85,
            confirmThreshold: 0.5,
            routeTools: [{ name: 'ask_gemini', description: 'Route to Gemini.', modelId: 'gemini-pro', examples: ['hard question'] }],
            scope: { apps: ['homeassistant'], includeNatives: false },
            prompt: 'Prefer exact entity names.',
          },
        }),
        input: 'anything',
        tools: [{ name: 'light_turn_on', description: 'Turn on a light.' }],
      }
    );
    expect(systemText).toContain('Prefer exact entity names.');
    expect(systemText).toContain('Example — user says "hard question" → call ask_gemini.');
    expect(systemText).toContain('integration tools in scope: homeassistant');
    expect(systemText).toContain('built-in tools are out of scope');
  });
});
