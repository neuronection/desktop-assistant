import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { setupProviderFromPreset, setDefaultModel, ProviderSetupStore } from '@main/ai/providers/setup';
import { KEY_PREFIX_HINTS, PROVIDER_PRESET_ORDER, PROVIDER_SETUP_DEFAULTS, PROVIDER_SETUP_PRESETS, guessPresetForKey } from '@shared/ai/providerPresets';
import { classifyProviderError, extractErrorStatus } from '@shared/ai/providerErrors';
import { resolveTaskModel } from '@shared/ai/tasks';
import { AiTask, AppConfig, LLMProvider, LLMProviderType } from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';

let idCounter = 0;

const makeStore = (config: AppConfig): ProviderSetupStore & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    getConfig: () => config,
    addLLMProvider: async (provider) => {
      calls.push('add');
      const row: LLMProvider = { ...provider, id: `generated-${++idCounter}` };
      config.providers.push(row);
      if (config.providers.length === 1) {
        config.defaultProviderId = row.id;
      }
      return row;
    },
    updateLLMProvider: async (provider) => {
      calls.push('update');
      const index = config.providers.findIndex((p) => p.id === provider.id);
      if (index < 0) {
        throw new Error(`Provider with ID ${provider.id} not found for update.`);
      }
      config.providers[index] = provider;
    },
    setDefaultLLMProvider: async (id) => {
      calls.push('setDefault');
      if (!config.providers.some((p) => p.id === id)) {
        throw new Error(`Provider with ID ${id} not found.`);
      }
      config.defaultProviderId = id;
    },
    updateConfig: async (updates) => {
      calls.push('updateConfig');
      Object.assign(config, updates);
    },
  };
};

const freshConfig = (): AppConfig => ({
  ...DEFAULT_CONFIG,
  providers: [],
  defaultProviderId: null,
  defaultChatModelId: null,
  taskAssignments: { ...DEFAULT_CONFIG.taskAssignments },
});

const manualRow = (overrides: Partial<LLMProvider> = {}): LLMProvider => ({
  id: `manual-${++idCounter}`,
  name: 'Manual row',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.openai.com/v1',
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
  availableModels: [],
  customModels: [],
  ...overrides,
});

const jsonFetch = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('provider preset metadata (plan 21 A1)', () => {
  it('keeps preset keys unique and the order array exhaustive', () => {
    const keys = Object.keys(PROVIDER_SETUP_PRESETS);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...PROVIDER_PRESET_ORDER]).toEqual(keys);
  });

  it('maps presets to approved wire types only', () => {
    const approved = Object.values(LLMProviderType);
    const advancedManual = [LLMProviderType.TOGETHER, LLMProviderType.FIREWORKS];
    for (const preset of Object.values(PROVIDER_SETUP_PRESETS)) {
      expect(approved).toContain(preset.type);
      expect(advancedManual).not.toContain(preset.type);
    }
  });

  it('flags exactly one local keyless preset: ollama', () => {
    const local = Object.values(PROVIDER_SETUP_PRESETS).filter((p) => p.local);
    expect(local.map((p) => p.key)).toEqual(['ollama']);
    expect(PROVIDER_SETUP_PRESETS.ollama.preferredModel?.modelId).toBe('gemma4:e4b');
  });

  it('pins fixed bases for anthropic and gemini only', () => {
    const fixed = Object.values(PROVIDER_SETUP_PRESETS).filter((p) => p.fixedBase);
    expect(fixed.map((p) => p.key).sort()).toEqual(['anthropic', 'gemini'].sort());
  });

  it('orders key prefix hints most-specific-first', () => {
    KEY_PREFIX_HINTS.forEach((hint, i) => {
      KEY_PREFIX_HINTS.slice(i + 1).forEach((later) => {
        expect(later.prefix.startsWith(hint.prefix) && later.prefix.length > hint.prefix.length).toBe(false);
      });
    });
  });

  it('guesses the vendor from key prefixes', () => {
    expect(guessPresetForKey('sk-ant-api03-xyz')).toBe('anthropic');
    expect(guessPresetForKey('sk-or-v1-abc')).toBe('openrouter');
    expect(guessPresetForKey('gsk_abc')).toBe('groq');
    expect(guessPresetForKey('AIzaSyXyz')).toBe('gemini');
    expect(guessPresetForKey('sk-abc123')).toBe('openai');
    expect(guessPresetForKey('')).toBeNull();
    expect(guessPresetForKey('totally-random')).toBeNull();
  });
});

describe('classifyProviderError (plan 21 A3)', () => {
  const classify = (overrides: Partial<Parameters<typeof classifyProviderError>[0]>) =>
    classifyProviderError({ message: '', localProvider: false, ...overrides });

  it.each([
    ['401 → invalid_key', { status: 401 }, 'invalid_key'],
    ['402 → insufficient_credit', { status: 402 }, 'insufficient_credit'],
    ['insufficient_quota body → insufficient_credit', { message: 'API request failed with status 400: insufficient_quota' }, 'insufficient_credit'],
    ['429 → new_user_quota', { status: 429 }, 'new_user_quota'],
    ['403+region → region_unavailable', { status: 403, message: 'ORGANIZATION_RESTRICTED: region not supported' }, 'region_unavailable'],
    ['403 plain → unknown', { status: 403, message: 'forbidden' }, 'unknown'],
    ['AbortError → timeout', { name: 'AbortError', message: 'The operation was aborted' }, 'timeout'],
    ['local connection refused → local_not_running', { localProvider: true, message: 'fetch failed: ECONNREFUSED 127.0.0.1:11434' }, 'local_not_running'],
    ['remote connection failure → unknown', { message: 'fetch failed' }, 'unknown'],
    ['no signal → unknown', {}, 'unknown'],
  ] as [string, Parameters<typeof classifyProviderError>[0], string][])('%s', (_label, input, expected) => {
    expect(classify(input).code).toBe(expected);
  });

  it('routes mis-pasted keys to the suspected vendor on 401', () => {
    expect(
      classify({ status: 401, apiKey: 'sk-or-v1-abc', attemptedPreset: 'openai' })
    ).toEqual({ code: 'invalid_key', suspectedVendor: 'openrouter' });
    expect(
      classify({ status: 401, apiKey: 'sk-ant-api03-x', attemptedPreset: 'openai' })
    ).toEqual({ code: 'invalid_key', suspectedVendor: 'anthropic' });
  });

  it('suppresses the hint when the guess matches the attempted preset', () => {
    expect(
      classify({ status: 401, apiKey: 'sk-abc123', attemptedPreset: 'openai' })
    ).toEqual({ code: 'invalid_key' });
  });

  it('extracts the status from catalog error messages', () => {
    expect(extractErrorStatus('API request failed with status 401: bad key')).toBe(401);
    expect(extractErrorStatus('fetch failed')).toBeNull();
  });
});

describe('setupProviderFromPreset (plan 21 A2/A6)', () => {
  it('sets up openai end to end: catalog persisted, CHAT+VISION gap-filled, default set', async () => {
    const fetchMock = jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] });
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', '  sk-test-key  ');

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(2);
    expect(result.assignedModelId).toBe('gpt-6.1-sol');
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(config.providers).toHaveLength(1);
    const row = config.providers[0];
    expect(result.provider?.id).toBe(row.id);
    expect(row.presetKey).toBe('openai');
    expect(row.type).toBe(LLMProviderType.OPENAI);
    expect(row.apiBase).toBe('https://api.openai.com/v1');
    expect(row.availableModels).toHaveLength(2);
    expect(row.availableModels?.every((m) => m.providerId === row.id)).toBe(true);
    expect(config.taskAssignments[AiTask.CHAT]).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
    expect(config.defaultProviderId).toBe(row.id);
  });

  it.each([
    ['gemini', LLMProviderType.GOOGLE, 'https://generativelanguage.googleapis.com/v1beta'],
    ['openrouter', LLMProviderType.OPENAI, 'https://openrouter.ai/api/v1'],
    ['groq', LLMProviderType.GROQ, 'https://api.groq.com/openai/v1'],
    ['mistral', LLMProviderType.OPENAI, 'https://api.mistral.ai/v1'],
    ['deepseek', LLMProviderType.OPENAI, 'https://api.deepseek.com/v1'],
    ['anthropic', LLMProviderType.ANTHROPIC, 'https://api.anthropic.com'],
  ])('maps %s to the existing wire type and preset base', async (key, type, apiBase) => {
    const fetchMock = jsonFetch({ data: [{ id: 'whatever' }], models: [] });
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, key, 'sk-key');

    expect(result.ok).toBe(true);
    expect(config.providers[0].type).toBe(type);
    expect(config.providers[0].apiBase).toBe(apiBase);
    expect(fetchMock.mock.calls[0][0]).toContain(apiBase);
  });

  it('connects ollama keylessly', async () => {
    const fetchMock = jsonFetch({ models: [{ name: 'llama3.3' }] });
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '');

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    expect(config.providers[0].apiKey).toBe('');
    expect(config.providers[0].type).toBe(LLMProviderType.OLLAMA);
  });

  it('ollama setup surfaces the preset decision rows keylessly and gap-fills with nimble (§13.3 follow-up)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ models: [{ name: 'llama3.3' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '');

    expect(result.ok).toBe(true);
    const row = config.providers[0];
    const decisionRow = row.availableModels?.find((m) => m.id === 'nimble');
    expect(decisionRow).toMatchObject({ caps: ['decision'], decisionTransport: 'systemone' });
    expect(result.assignedDecisionSlots).toMatchObject({
      decision: 'nimble',
    });
    expect(row.apiKey).toBe('');
  });

  it('re-setup with the same preset updates the key without duplicating the row', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    await setupProviderFromPreset(store, 'openai', 'sk-first');
    const result = await setupProviderFromPreset(store, 'openai', 'sk-second');

    expect(result.ok).toBe(true);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].apiKey).toBe('sk-second');
  });

  it('adopts a manual row with the same type+apiBase instead of duplicating', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }] }));
    const config = freshConfig();
    const manual = manualRow({ name: 'My OpenAI' });
    config.providers.push(manual);
    config.defaultProviderId = manual.id;
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-new');

    expect(result.ok).toBe(true);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe(manual.id);
    expect(config.providers[0].name).toBe('My OpenAI');
    expect(config.providers[0].presetKey).toBe('openai');
    expect(config.providers[0].apiKey).toBe('sk-new');
  });

  it('adopts the earliest row when two manual rows share type+apiBase', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }] }));
    const config = freshConfig();
    const earliest = manualRow({ id: 'manual-first', apiKey: 'sk-old-a' });
    const later = manualRow({ id: 'manual-second', apiKey: 'sk-old-b' });
    config.providers.push(earliest, later);
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-new');

    expect(result.ok).toBe(true);
    expect(config.providers).toHaveLength(2);
    expect(config.providers[0].id).toBe('manual-first');
    expect(config.providers[0].presetKey).toBe('openai');
    expect(config.providers[0].apiKey).toBe('sk-new');
    expect(config.providers[1].id).toBe('manual-second');
    expect(config.providers[1].presetKey).toBeUndefined();
    expect(config.providers[1].apiKey).toBe('sk-old-b');
  });

  it('never clobbers a live CHAT assignment', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }] }));
    const config = freshConfig();
    const manual = manualRow({ customModels: [{ id: 'my-custom-model', name: 'Custom', providerType: LLMProviderType.OPENAI, providerId: 'manual-x' }] });
    config.providers.push(manual);
    config.defaultProviderId = manual.id;
    config.taskAssignments[AiTask.CHAT] = 'my-custom-model';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.assignedModelId).toBeNull();
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('my-custom-model');
  });

  it('never clobbers a live VISION assignment', async () => {
    vi.stubGlobal('fetch', jsonFetch({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] }));
    const config = freshConfig();
    const manual = manualRow({
      id: 'manual-gemini',
      type: LLMProviderType.GOOGLE,
      apiBase: 'https://generativelanguage.googleapis.com/v1beta',
      customModels: [{ id: 'my-vision-model', name: 'CustomV', providerType: LLMProviderType.GOOGLE, providerId: 'manual-gemini' }],
    });
    config.providers.push(manual);
    config.taskAssignments[AiTask.VISION] = 'my-vision-model';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'gemini', 'AIza-key');

    expect(result.ok).toBe(true);
    expect(result.assignedVisionModelId).toBeNull();
    expect(result.assignedModelId).toBe('gemini-3.8-flash');
    expect(config.taskAssignments[AiTask.VISION]).toBe('my-vision-model');
  });

  it('leaves VISION unassigned for presets without a bundled preferred model', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'mixtral-8x22b' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'mistral', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.assignedModelId).toBeNull();
    expect(result.assignedVisionModelId).toBeNull();
    expect(config.taskAssignments[AiTask.VISION]).toBeNull();
  });

  it('saves the provider with CHAT unassigned when the bundled id is absent', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-99-turbo' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(result.assignedModelId).toBeNull();
    expect(config.providers).toHaveLength(1);
    expect(config.taskAssignments[AiTask.CHAT]).toBeNull();
  });

  it('persists nothing when the key is invalid', async () => {
    vi.stubGlobal('fetch', jsonFetch({ error: { message: 'Incorrect API key' } }, 401));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-bad');

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_key');
    expect(result.vendorMessage).toContain('401');
    expect(store.calls).toHaveLength(0);
    expect(config.providers).toHaveLength(0);
    expect(config.defaultProviderId).toBeNull();
  });

  it('rejects unknown presets without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'not-a-preset', 'sk-key');

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('unknown_preset');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.calls).toHaveLength(0);
  });

  it('classifies a hanging fetch as timeout via the abort controller', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const store = makeStore(config);

    const promise = setupProviderFromPreset(store, 'openai', 'sk-key');
    await vi.advanceTimersByTimeAsync(PROVIDER_SETUP_DEFAULTS.timeout + 1);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('timeout');
    expect(store.calls).toHaveLength(0);
  });

  it('curation persists only curated ids when the catalog contains them', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }, { id: 'gpt-oss-120b' }, { id: 'o3-deep-research' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(2);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
  });

  it('falls back to the full catalog and flags the miss when no curated id matches (drift)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-99-turbo' }, { id: 'gpt-99-mini' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(2);
    expect(config.providers[0].availableModels).toHaveLength(2);
    expect(result.curatedMissed).toBe(true);
    expect(result.assignedModelId).toBeNull();
  });

  it('matches curated ids against dated catalog snapshots and binds the resolved id', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol-2026-10-05' }, { id: 'gpt-oss-120b' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.curatedMissed).toBe(false);
    expect(result.catalogCount).toBe(1);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6.1-sol-2026-10-05']);
    expect(result.assignedModelId).toBe('gpt-6.1-sol-2026-10-05');
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol-2026-10-05');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('gpt-6.1-sol-2026-10-05');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol-2026-10-05');
  });

  it('binds the first curated match when the preferred id is absent', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6-luna-2026-02-01' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.curatedMissed).toBe(false);
    expect(result.assignedModelId).toBe('gpt-6-luna-2026-02-01');
    expect(result.assignedVisionModelId).toBe('gpt-6-luna-2026-02-01');
  });

  it('appends the fetched catalog onto existing models without deleting or duplicating', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    const manual = manualRow({
      availableModels: [
        { id: 'old-favorite', name: 'Old', providerType: LLMProviderType.OPENAI, providerId: 'manual-x' },
        { id: 'gpt-6.1-sol', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'manual-x' },
      ],
      customModels: [{ id: 'my-custom', name: 'Custom', providerType: LLMProviderType.OPENAI, providerId: 'manual-x' }],
    });
    config.providers.push(manual);
    config.defaultProviderId = manual.id;
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    const ids = config.providers[0].availableModels?.map((m) => m.id);
    expect(ids).toEqual(['old-favorite', 'gpt-6.1-sol', 'gpt-6-luna']);
    expect(config.providers[0].customModels?.map((m) => m.id)).toEqual(['my-custom']);
  });

  it('curates whisper and gap-fills the transcription task', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'whisper-1' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'whisper-1']);
    expect(config.providers[0].availableModels?.find((m) => m.id === 'whisper-1')?.caps).toEqual(['stt']);
    expect(result.assignedSttModelId).toBe('whisper-1');
    expect(config.taskAssignments[AiTask.STT]).toBe('whisper-1');
  });

  it('skips the transcription binding when the review disables it', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'whisper-1' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key', undefined, { bindStt: false });

    expect(result.ok).toBe(true);
    expect(result.assignedSttModelId).toBeNull();
    expect(config.taskAssignments[AiTask.STT]).toBeNull();
  });

  it('honors review options: curated subset and disabled bindings', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }, { id: 'gpt-6-sol' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key', undefined, {
      curatedIds: ['gpt-6-luna'],
      bindChat: false,
      bindVision: false,
    });

    expect(result.ok).toBe(true);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6-luna']);
    expect(result.assignedModelId).toBeNull();
    expect(result.assignedVisionModelId).toBeNull();
    expect(config.taskAssignments[AiTask.CHAT]).toBeNull();
    expect(config.taskAssignments[AiTask.VISION]).toBeNull();
  });

  it('appends nothing when the review selection is empty', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key', undefined, { curatedIds: [] });

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(0);
    expect(config.providers[0].availableModels).toEqual([]);
  });

  it('persists inferred capabilities on fetched models and heals legacy uncapped rows', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    const manual = manualRow({
      availableModels: [
        { id: 'old-uncapped-model', name: 'Old', providerType: LLMProviderType.OPENAI, providerId: 'manual-x' },
      ],
    });
    config.providers.push(manual);
    config.defaultProviderId = manual.id;
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    const models = config.providers[0].availableModels ?? [];
    const byId = Object.fromEntries(models.map((m) => [m.id, m.caps]));
    expect(byId['gpt-6.1-sol']).toEqual(['text', 'tools', 'vision']);
    expect(byId['gpt-6-luna']).toEqual(['text', 'tools', 'vision']);
    expect(byId['old-uncapped-model']).toEqual(['text', 'tools']);
  });

  it('treats assignments pointing at dead model ids as unassigned and rebinds', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    config.taskAssignments[AiTask.CHAT] = 'ghost-model-from-the-136-era';
    config.taskAssignments[AiTask.VISION] = 'ghost-vision-model';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.assignedModelId).toBe('gpt-6.1-sol');
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
  });

  it('binds both text and vision on an exact-id curated match', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(2);
    expect(result.assignedModelId).toBe('gpt-6.1-sol');
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
  });

  it('binds vision to an existing text-only assignment when that model is vision-capable', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }] }));
    const config = freshConfig();
    config.taskAssignments[AiTask.CHAT] = 'gpt-6-luna';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.assignedModelId).toBeNull();
    expect(result.assignedVisionModelId).toBe('gpt-6-luna');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('gpt-6-luna');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6-luna');
  });

  it('keeps a live non-vision text assignment and binds the curated model for vision instead', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'gpt-6-luna' }, { id: 'text-only-model' }] }));
    const config = freshConfig();
    const manual = manualRow({ customModels: [{ id: 'text-only-model', name: 'Text', providerType: LLMProviderType.OPENAI, providerId: 'manual-x', caps: ['text'] }] });
    config.providers.push(manual);
    config.defaultProviderId = manual.id;
    config.taskAssignments[AiTask.CHAT] = 'text-only-model';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.assignedModelId).toBeNull();
    expect(result.assignedVisionModelId).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.CHAT]).toBe('text-only-model');
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
  });

  it('re-runs setup on demand with the stored keyring key', async () => {
    let usedKey = '';
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      usedKey = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const config = freshConfig();
    const existing = manualRow({ presetKey: 'openai', apiKeyHint: 'sk-…' });
    config.providers.push(existing);
    config.defaultProviderId = existing.id;
    const store = makeStore(config);
    store.resolveSecret = async (id) => (id === existing.id ? 'sk-stored-key' : null);

    const result = await setupProviderFromPreset(store, 'openai', '');

    expect(result.ok).toBe(true);
    expect(usedKey).toBe('Bearer sk-stored-key');
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6.1-sol']);
  });

  it('routes a refused local connection to local_not_running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '');

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('local_not_running');
    expect(store.calls).toHaveLength(0);
  });
});

describe('embeddings gap-fill (plan 26, bind_embeddings)', () => {
  it('gap-fills the empty embed slot from the preset embeddings model (ollama, unfiltered catalog)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ models: [{ name: 'llama3.3' }, { name: 'embeddinggemma-2:440m' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '');

    expect(result.ok).toBe(true);
    const row = config.providers[0];
    const embedRow = row.availableModels?.find((m) => m.id === 'embeddinggemma-2:440m');
    expect(embedRow?.caps).toEqual(['embeddings']);
    expect(result.assignedEmbeddingsModel).toBe('embeddinggemma-2:440m');
    expect(config.taskAssignments[AiTask.EMBED]).toBe('embeddinggemma-2:440m');
    expect(config.taskAssignments[AiTask.CHAT]).toBeNull();
  });

  it('curates the embeddings model and gap-fills the embed slot (openai happy path)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'gpt-6.1-sol' }, { id: 'text-embedding-3-small' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openai', 'sk-key');

    expect(result.ok).toBe(true);
    expect(result.curatedMissed).toBe(false);
    expect(config.providers[0].availableModels?.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'text-embedding-3-small']);
    expect(config.providers[0].availableModels?.find((m) => m.id === 'text-embedding-3-small')?.caps).toEqual(['embeddings']);
    expect(result.assignedEmbeddingsModel).toBe('text-embedding-3-small');
    expect(config.taskAssignments[AiTask.EMBED]).toBe('text-embedding-3-small');
  });

  it('never clobbers a live embed assignment (gap-fill only)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ models: [{ name: 'llama3.3' }, { name: 'nomic-embed-text' }] }));
    const config = freshConfig();
    const manual = manualRow({
      id: 'manual-ollama',
      type: LLMProviderType.OLLAMA,
      apiBase: 'http://localhost:11434/v1',
      customModels: [{ id: 'my-embed', name: 'My embed', providerType: LLMProviderType.OLLAMA, providerId: 'manual-ollama', caps: ['embeddings'] }],
    });
    config.providers.push(manual);
    config.taskAssignments[AiTask.EMBED] = 'my-embed';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '');

    expect(result.ok).toBe(true);
    expect(result.assignedEmbeddingsModel).toBeNull();
    expect(config.taskAssignments[AiTask.EMBED]).toBe('my-embed');
  });

  it('skips the embeddings binding when the review disables it (bind_embeddings off)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ models: [{ name: 'llama3.3' }, { name: 'nomic-embed-text' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'ollama', '', undefined, { bindEmbeddings: false });

    expect(result.ok).toBe(true);
    expect(result.assignedEmbeddingsModel).toBeNull();
    expect(config.taskAssignments[AiTask.EMBED]).toBeNull();
  });

  it('serves the embed slot through the generic task resolver', async () => {
    const config = freshConfig();
    const provider = manualRow({
      id: 'p-embed',
      availableModels: [{ id: 'text-embedding-3-small', name: 'Embed', providerType: LLMProviderType.OPENAI, providerId: 'p-embed', caps: ['embeddings'] }],
    });
    config.providers.push(provider);
    config.taskAssignments[AiTask.EMBED] = 'text-embedding-3-small';

    const resolved = resolveTaskModel(config, AiTask.EMBED);
    expect(resolved?.modelId).toBe('text-embedding-3-small');
    expect(resolved?.providerId).toBe('p-embed');
    // a dead preferred id falls through to the slot assignment
    expect(resolveTaskModel(config, AiTask.EMBED, 'ghost-embed')?.modelId).toBe('text-embedding-3-small');
    // unset slot resolves to null — no fallback to CHAT
    config.taskAssignments[AiTask.EMBED] = null;
    expect(resolveTaskModel(config, AiTask.EMBED)).toBeNull();
  });

  it('rejects a non-embeddings model on the embed slot (setDefaultModel)', async () => {
    const config = freshConfig();
    const provider = manualRow({
      id: 'p1',
      availableModels: [
        { id: 'text-embedding-3-small', name: 'Embed', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['embeddings'] },
        { id: 'text-only-model', name: 'Text', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['text'] },
      ],
    });
    config.providers.push(provider);
    const store = makeStore(config);

    await setDefaultModel(store, 'p1', 'text-embedding-3-small', AiTask.EMBED);
    expect(config.taskAssignments[AiTask.EMBED]).toBe('text-embedding-3-small');

    await expect(setDefaultModel(store, 'p1', 'text-only-model', AiTask.EMBED)).rejects.toThrow(/does not support embeddings/);
    expect(config.taskAssignments[AiTask.EMBED]).toBe('text-embedding-3-small');
  });
});

describe('setDefaultModel (plan 21 A4)', () => {
  it('upserts the model, binds CHAT, and switches the default provider', async () => {
    const config = freshConfig();
    const provider = manualRow({ id: 'p1', type: LLMProviderType.ANTHROPIC, apiBase: 'https://api.anthropic.com' });
    config.providers.push(provider);
    config.defaultProviderId = 'other';
    const store = makeStore(config);

    await setDefaultModel(store, 'p1', 'claude-new-x');

    expect(config.taskAssignments[AiTask.CHAT]).toBe('claude-new-x');
    expect(config.defaultProviderId).toBe('p1');
    const custom = config.providers[0].customModels ?? [];
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ id: 'claude-new-x', providerId: 'p1', providerType: LLMProviderType.ANTHROPIC });
  });

  it('rejects a model id that belongs to another provider', async () => {
    const config = freshConfig();
    const first = manualRow({ id: 'p1', availableModels: [{ id: 'shared-model', name: 'Shared', providerType: LLMProviderType.OPENAI, providerId: 'p1' }] });
    const second = manualRow({ id: 'p2' });
    config.providers.push(first, second);
    const store = makeStore(config);

    await expect(setDefaultModel(store, 'p2', 'shared-model')).rejects.toThrow(/another provider/);
    expect(config.taskAssignments[AiTask.CHAT]).toBeNull();
  });

  it('binds without duplicating when the model already exists on the provider', async () => {
    const config = freshConfig();
    const provider = manualRow({
      id: 'p1',
      availableModels: [{ id: 'known', name: 'Known', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
    });
    config.providers.push(provider);
    const store = makeStore(config);

    await setDefaultModel(store, 'p1', 'known');

    expect(config.taskAssignments[AiTask.CHAT]).toBe('known');
    expect(config.providers[0].customModels ?? []).toHaveLength(0);
  });

  it('binds the vision task for a vision-capable model and rejects a non-vision one', async () => {
    const config = freshConfig();
    const provider = manualRow({
      id: 'p1',
      availableModels: [
        { id: 'gpt-6.1-sol', name: 'Terra', providerType: LLMProviderType.OPENAI, providerId: 'p1' },
        { id: 'text-only-model', name: 'Text', providerType: LLMProviderType.OPENAI, providerId: 'p1', caps: ['text'] },
      ],
    });
    config.providers.push(provider);
    const store = makeStore(config);

    await setDefaultModel(store, 'p1', 'gpt-6.1-sol', AiTask.VISION);
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
    expect(config.taskAssignments[AiTask.CHAT]).toBeNull();

    await expect(setDefaultModel(store, 'p1', 'text-only-model', AiTask.VISION)).rejects.toThrow(/does not support vision/);
    expect(config.taskAssignments[AiTask.VISION]).toBe('gpt-6.1-sol');
  });
});

describe('decision models in provider setup (plan 26 S3, bind_decision)', () => {
  const systemOneOk = jsonFetch({
    model: 'jev-latest',
    answers: { __probe__: { type: 'noul', noul: 1 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  it('openrouter setup appends the decision model rows and gap-fills empty decision slots', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'openrouter/auto' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openrouter', 'sk-or-key');

    expect(result.ok).toBe(true);
    const row = config.providers[0];
    const decisionRow = row.availableModels?.find((m) => m.id === 'typesafe/jev-1.13');
    expect(decisionRow).toMatchObject({ caps: ['decision'], decisionTransport: 'systemone' });
    expect(result.assignedDecisionSlots).toEqual({
      decision: 'typesafe/jev-1.13',
    });
    expect(config.taskAssignments['decision']).toBe('typesafe/jev-1.13');
    // ADR-0036 §3: kind slots inherit — setup binds none of them.
    expect(config.taskAssignments['decision:tool-dispatch']).toBeUndefined();
    expect(result.assignedModelId).toBe('openrouter/auto');
  });

  it('skips decision bindings when the review disables bind_decision', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'openrouter/auto' }] }));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openrouter', 'sk-or-key', undefined, { bindDecision: false });

    expect(result.ok).toBe(true);
    expect(result.assignedDecisionSlots).toBeUndefined();
    expect(config.taskAssignments['decision:tool-dispatch']).toBeUndefined();
  });

  it('never clobbers live decision slots (gap-fill only)', async () => {
    vi.stubGlobal('fetch', jsonFetch({ data: [{ id: 'openrouter/auto' }] }));
    const config = freshConfig();
    const other = manualRow({
      id: 'other-or',
      name: 'Other OpenRouter',
      apiBase: 'https://openrouter.ai/api/v1',
      availableModels: [
        { id: 'my-live-jev', name: 'My pinned Jev', providerType: LLMProviderType.OPENAI, providerId: 'other-or', caps: ['decision'], decisionTransport: 'systemone' },
      ],
    });
    config.providers.push(other);
    config.taskAssignments['decision:choice' as keyof typeof config.taskAssignments] = 'my-live-jev';
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'openrouter', 'sk-or-key');

    expect(result.assignedDecisionSlots).toEqual({
      decision: 'typesafe/jev-1.13',
    });
    expect(config.taskAssignments['decision:choice']).toBe('my-live-jev');
  });

  it('validates the decision-only typesafe preset via the decision probe, not a catalog fetch', async () => {
    const probe = jsonFetch({
      model: 'jev-latest',
      answers: { __probe__: { type: 'noul', noul: 1 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    vi.stubGlobal('fetch', probe);
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'typesafe', 'ts-key');

    expect(result.ok).toBe(true);
    expect(result.catalogCount).toBe(1);
    expect(probe.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    const row = config.providers[0];
    expect(row.type).toBe(LLMProviderType.DECISION);
    expect(row.presetKey).toBe('typesafe');
    expect(row.availableModels?.[0]).toMatchObject({ id: 'jev-latest', caps: ['decision'], decisionTransport: 'systemone' });
    expect(config.taskAssignments['decision']).toBe('jev-latest');
    expect(result.assignedModelId).toBeNull();
  });

  it('persists nothing when the decision probe classifies an invalid key', async () => {
    vi.stubGlobal('fetch', jsonFetch({ error: 'bad key' }, 401));
    const config = freshConfig();
    const store = makeStore(config);

    const result = await setupProviderFromPreset(store, 'typesafe', 'wrong');

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_key');
    expect(store.calls).toEqual([]);
    expect(config.providers).toHaveLength(0);
  });
});
