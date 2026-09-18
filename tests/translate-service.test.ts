import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSecret, setSecret, deleteSecret } = vi.hoisted(() => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({}) },
}));

vi.mock('@main/services/SecretService', () => ({
  SecretService: {
    getInstance: () => ({ getSecret, setSecret, deleteSecret }),
    keyHint: (key: string) => `${key.slice(0, 4)}…`,
  },
  providerSecretKey: (id: string) => `provider:${id}`,
}));

import { TranslateService, translationProviderSecretKey } from '@main/services/TranslateService';
import { TRANSLATION_FETCHERS } from '@main/ai/translate';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';
import type { TranslationSettings } from '@shared/translation';

const REAL_TRANSLATION_FETCHERS = { ...TRANSLATION_FETCHERS };

function restoreFetchers(): void {
  for (const key of Object.keys(TRANSLATION_FETCHERS) as (keyof typeof TRANSLATION_FETCHERS)[]) {
    delete TRANSLATION_FETCHERS[key];
  }
  Object.assign(TRANSLATION_FETCHERS, REAL_TRANSLATION_FETCHERS);
}

const provider = () => ({
  ...DEFAULT_CONFIG.providers[0],
  id: 'p1',
  type: LLMProviderType.OPENAI,
  availableModels: [{ id: 'm1', name: 'Model One', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
});

const configWith = (overrides: {
  translateModel?: string | null;
  translation?: Partial<TranslationSettings>;
} = {}): AppConfig =>
  ({
    ...DEFAULT_CONFIG,
    providers: [provider()],
    taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, translate: overrides.translateModel ?? null },
    translation: {
      mode: 'auto',
      defaultTarget: null,
      providers: [],
      ...overrides.translation,
    },
  }) as AppConfig;

const makeService = (
  config: AppConfig,
  invoke: (request: unknown) => Promise<string> = vi.fn().mockResolvedValue('Hola'),
  secret = vi.fn().mockResolvedValue(null)
) =>
  new TranslateService({
    configService: {
      getConfig: () => config,
      updateConfig: vi.fn(async (updates: Partial<AppConfig>) => {
        Object.assign(config, updates);
      }),
    },
    gateway: { invoke },
    getSecret: secret,
  });

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('TranslateService input validation', () => {
  it('rejects empty text', async () => {
    const service = makeService(configWith());
    await expect(service.translate({ text: '   ', target: 'el' })).rejects.toThrow(/No text to translate/);
  });

  it('rejects over-cap input with the configured cap', async () => {
    const service = makeService(configWith());
    await expect(service.translate({ text: 'x'.repeat(10_001), target: 'el' })).rejects.toThrow(/too long/);
  });

  it('rejects unknown target and source languages', async () => {
    const service = makeService(configWith());
    await expect(service.translate({ text: 'hi', target: 'xx' })).rejects.toThrow(/Unknown target language 'xx'/);
    await expect(service.translate({ text: 'hi', target: 'el', source: 'zz' })).rejects.toThrow(/Unknown source language 'zz'/);
  });

  it('requires a target when none is given and no default is set', async () => {
    const service = makeService(configWith());
    await expect(service.translate({ text: 'hi' })).rejects.toThrow(/No target language given/);
  });

  it('normalizes the configured default target', async () => {
    const invoke = vi.fn().mockResolvedValue('Hola');
    const service = makeService(
      configWith({ translateModel: 'm1', translation: { defaultTarget: ' ES ' } }),
      invoke,
      getSecret
    );
    getSecret.mockResolvedValue('sk-keyring');
    const result = await service.translate({ text: 'hi' });
    expect(result).toEqual({ text: 'Hola', engine: 'llm', target: 'es' });
    expect(invoke.mock.calls[0][0].messages[0].content).toContain('Spanish (es)');
  });
});

describe('TranslateService llm engine', () => {
  beforeEach(() => {
    getSecret.mockReset();
  });

  it('resolves the assigned model, reads the keyring key, and audits through the gateway request', async () => {
    const invoke = vi.fn().mockResolvedValue('  Καλημέρα  ');
    const service = makeService(configWith({ translateModel: 'm1' }), invoke, getSecret);
    getSecret.mockResolvedValue('sk-keyring');
    const result = await service.translate({ text: 'good morning', target: 'el' });
    expect(getSecret).toHaveBeenCalledWith('provider:p1');
    const request = invoke.mock.calls[0][0];
    expect(request.task).toBe('translate');
    expect(request.modelId).toBe('m1');
    expect(request.apiKey).toBe('sk-keyring');
    expect(request.overrides).toEqual({ temperature: 0 });
    expect(result).toEqual({ text: 'Καλημέρα', engine: 'llm', target: 'el' });
  });

  it('treats a keyless non-ollama assignment as unavailable', async () => {
    getSecret.mockResolvedValue(null);
    const service = makeService(configWith({ translateModel: 'm1' }));
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/not configured/);
  });

  it('allows a keyless ollama assignment with a local-server placeholder', async () => {
    const invoke = vi.fn().mockResolvedValue('Hola');
    const config = configWith({ translateModel: 'm1' });
    config.providers = [{ ...provider(), type: LLMProviderType.OLLAMA }];
    const service = makeService(config, invoke, getSecret);
    getSecret.mockResolvedValue(null);
    await service.translate({ text: 'hi', target: 'es' });
    expect(invoke.mock.calls[0][0].apiKey).toBe('local-server');
  });

  it('propagates abort errors instead of treating them as engine failures', async () => {
    const invoke = vi.fn().mockRejectedValue(abortError());
    const service = makeService(configWith({ translateModel: 'm1' }), invoke, getSecret);
    getSecret.mockResolvedValue('sk-keyring');
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/aborted/);
  });
});

describe('TranslateService custom languages', () => {
  beforeEach(() => {
    getSecret.mockReset();
  });

  const customConfig = () =>
    configWith({
      translateModel: 'm1',
      translation: {
        customLanguages: [{ code: 'grc', name: 'Ancient Greek', nativeName: 'Ἑλληνική' }],
      },
    });

  it('accepts a custom target code and labels it in the prompt', async () => {
    const invoke = vi.fn().mockResolvedValue('Χαῖρε');
    const service = makeService(customConfig(), invoke, getSecret);
    getSecret.mockResolvedValue('sk-keyring');
    const result = await service.translate({ text: 'hello', target: 'grc' });
    expect(result).toEqual({ text: 'Χαῖρε', engine: 'llm', target: 'grc' });
    expect(invoke.mock.calls[0][0].messages[0].content).toContain('Ancient Greek (grc)');
  });

  it('accepts custom codes case-insensitively and as source', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    const service = makeService(customConfig(), invoke, getSecret);
    getSecret.mockResolvedValue('sk-keyring');
    await service.translate({ text: 'hi', target: 'GRC', source: 'grc' });
    expect(invoke.mock.calls[0][0].messages[0].content).toContain('from Ancient Greek');
  });

  it('rejects codes that are neither built-in nor custom', async () => {
    const service = makeService(customConfig(), vi.fn(), getSecret);
    getSecret.mockResolvedValue('sk-keyring');
    await expect(service.translate({ text: 'hi', target: 'tok' })).rejects.toThrow(/Unknown target language 'tok'/);
  });

  it('uses a custom language as the default target', async () => {
    const invoke = vi.fn().mockResolvedValue('ok');
    const service = makeService(
      configWith({
        translateModel: 'm1',
        translation: { defaultTarget: 'grc', customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] },
      }),
      invoke,
      getSecret
    );
    getSecret.mockResolvedValue('sk-keyring');
    await service.translate({ text: 'hi' });
    expect(invoke.mock.calls[0][0].messages[0].content).toContain('into Ancient Greek (grc)');
  });
});

describe('TranslateService engine dispatch', () => {
  beforeEach(() => {
    getSecret.mockReset();
  });

  afterEach(() => {
    restoreFetchers();
  });

  it('mode llm: unassigned task errors without touching services', async () => {
    const service = makeService(configWith({ translation: { mode: 'llm' } }));
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/No translation model is assigned/);
  });

  it('mode service: aggregates provider failures with their names', async () => {
    const service = makeService(
      configWith({ translation: { mode: 'service', providers: [{ id: 'srv1', name: 'DeepL', type: 'deepl', enabled: true }] } })
    );
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/DeepL: DeepL needs an API key/);
  });

  it('mode auto: falls through a failing service engine to llm', async () => {
    const invoke = vi.fn().mockResolvedValue('Hola');
    const service = makeService(
      configWith({
        translateModel: 'm1',
        translation: {
          mode: 'auto',
          providers: [{ id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true }],
        },
      }),
      invoke,
      getSecret
    );
    getSecret.mockResolvedValue('sk-keyring');
    const result = await service.translate({ text: 'hi', target: 'es' });
    expect(result.engine).toBe('llm');
  });

  it('service engine: resolves the keyring key and passes config, text, and signal through', async () => {
    const fetcher = vi.fn().mockResolvedValue({ text: 'Hola', engine: 'libretranslate', source: 'en' });
    TRANSLATION_FETCHERS.libretranslate = fetcher;
    const controller = new AbortController();
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv2', name: 'Keyed LT', type: 'libretranslate', enabled: true, keyHint: 'abcd' }],
        },
      }),
      vi.fn().mockResolvedValue(''),
      getSecret
    );
    getSecret.mockResolvedValue('srv-key');
    const result = await service.translate({ text: 'hi', target: 'es' }, { signal: controller.signal });
    expect(getSecret).toHaveBeenCalledWith(translationProviderSecretKey('srv2'));
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'srv-key', text: 'hi', target: 'es', signal: expect.any(AbortSignal) })
    );
    expect(result).toEqual({ text: 'Hola', engine: 'libretranslate', target: 'es', source: 'en' });
  });

  it('service engine: skips the keyring when no key hint exists', async () => {
    const fetcher = vi.fn().mockResolvedValue({ text: 'Hola', engine: 'libretranslate' });
    TRANSLATION_FETCHERS.libretranslate = fetcher;
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true }],
        },
      }),
      vi.fn().mockResolvedValue(''),
      getSecret
    );
    const result = await service.translate({ text: 'hi', target: 'es' });
    expect(getSecret).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ key: null }));
    expect(result).toEqual({ text: 'Hola', engine: 'libretranslate', target: 'es' });
  });

  it('service engine: fetcher failures fall through and aggregate', async () => {
    TRANSLATION_FETCHERS.libretranslate = vi.fn().mockRejectedValue(new Error('connection refused'));
    TRANSLATION_FETCHERS.deepl = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [
            { id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true },
            { id: 'srv2', name: 'DeepL', type: 'deepl', enabled: true },
          ],
        },
      })
    );
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(
      /Translation failed\. Local LT: connection refused\.? DeepL: quota exceeded/
    );
  });

  it('aggregates every engine failure in the final error', async () => {
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true }],
        },
      })
    );
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/Translation failed\. Local LT:/);
  });
});

describe('TranslateService service-engine timeouts', () => {
  beforeEach(() => {
    getSecret.mockReset();
  });

  afterEach(() => {
    restoreFetchers();
  });

  it('maps an internal timeout abort to a typed per-provider timeout error', async () => {
    TRANSLATION_FETCHERS.libretranslate = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true }],
        },
      })
    );
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/Local LT: timed out after 10s\./);
  });

  it('propagates an externally aborted call as AbortError', async () => {
    TRANSLATION_FETCHERS.libretranslate = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true }],
        },
      })
    );
    const controller = new AbortController();
    controller.abort();
    await expect(service.translate({ text: 'hi', target: 'el' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('TranslateService provider CRUD', () => {
  beforeEach(() => {
    getSecret.mockReset();
    setSecret.mockReset();
    deleteSecret.mockReset();
  });

  afterEach(() => {
    restoreFetchers();
  });

  const crudConfig = () =>
    configWith({
      translation: {
        mode: 'auto',
        providers: [{ id: 'a', name: 'Alpha LT', type: 'libretranslate', enabled: true, apiBase: 'http://alpha.local' }],
      },
    });

  it('saves a provider, stripping the key into the keyring with a masked hint', async () => {
    const service = makeService(crudConfig());
    setSecret.mockResolvedValue(undefined);
    const view = await service.saveProvider({
      id: 'b',
      name: 'DeepL Main',
      type: 'deepl',
      enabled: true,
      key: 'abcd1234:fx',
    });
    expect(setSecret).toHaveBeenCalledWith('translation:b:key', 'abcd1234:fx');
    expect(view.hasKey).toBe(true);
    expect(view.config.keyHint).toBe('abcd…');
    expect(view.config).not.toHaveProperty('key');
    const stored = service.listProviders().find((provider) => provider.config.id === 'b');
    expect(stored?.config.enabled).toBe(true);
  });

  it('rejects DeepL without a key and LibreTranslate without a server URL', async () => {
    const service = makeService(crudConfig());
    await expect(
      service.saveProvider({ id: 'b', name: 'DeepL', type: 'deepl', enabled: true })
    ).rejects.toThrow(/DeepL needs an API key/);
    await expect(
      service.saveProvider({ id: 'b', name: 'LT', type: 'libretranslate', enabled: true })
    ).rejects.toThrow(/LibreTranslate needs a server URL/);
    await expect(
      service.saveProvider({ id: 'b', name: 'LT', type: 'libretranslate', enabled: true, apiBase: 'ftp://bad' })
    ).rejects.toThrow(/http\(s\) URL/);
  });

  it('delete clears the stored key; enable and move preserve the rest of the translation section', async () => {
    const config = crudConfig();
    config.translation.providers.push({ id: 'b', name: 'Beta LT', type: 'libretranslate', enabled: false, apiBase: 'http://beta.local', keyHint: 'abcd…' });
    const service = makeService(config);
    deleteSecret.mockResolvedValue(undefined);

    await expect(service.moveProvider('a', 'up')).resolves.toBe(false);
    await expect(service.moveProvider('b', 'up')).resolves.toBe(true);
    expect(service.listProviders().map((provider) => provider.config.id)).toEqual(['b', 'a']);
    expect(config.translation.mode).toBe('auto');
    expect(config.translation.customLanguages).toEqual([]);

    await expect(service.setProviderEnabled('b', true)).resolves.toBe(true);
    expect(service.listProviders()[0].config.enabled).toBe(true);

    await expect(service.deleteProvider('b')).resolves.toBe(true);
    expect(deleteSecret).toHaveBeenCalledWith('translation:b:key');
    expect(service.listProviders()).toHaveLength(1);
  });

  it('testProvider translates a tiny probe through the injected fetch', async () => {
    const service = makeService(crudConfig());
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detectedLanguage: { confidence: 1, language: 'en' }, translatedText: 'Hola' }), { status: 200 })
    );
    const result = await service.testProvider('a', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.translation).toBe('Hola');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://alpha.local/translate');
    expect(JSON.parse(init.body).target).toBe('en');
  });

  it('testProvider reports failures without throwing', async () => {
    TRANSLATION_FETCHERS.deepl = vi.fn().mockRejectedValue(new Error('HTTP 403 — DeepL rejected the API key.'));
    const config = crudConfig();
    config.translation.providers.push({ id: 'b', name: 'DeepL', type: 'deepl', enabled: true, keyHint: 'abcd…' });
    const service = makeService(config, vi.fn().mockResolvedValue(''), getSecret);
    getSecret.mockResolvedValue('sk-key');
    const result = await service.testProvider('b');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/403/);
    expect(getSecret).toHaveBeenCalledWith('translation:b:key');
  });
});

describe('TranslateService ordered failover across real engines', () => {
  beforeEach(() => {
    getSecret.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tries providers in array order and returns the first success with detection', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ translations: [{ text: 'Hola', detected_source_language: 'EN' }] }), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService(
      configWith({
        translation: {
          mode: 'auto',
          providers: [
            { id: 'srv1', name: 'Local LT', type: 'libretranslate', enabled: true, apiBase: 'http://lt.local' },
            { id: 'srv2', name: 'DeepL', type: 'deepl', enabled: true, keyHint: 'abcd…' },
          ],
        },
      }),
      vi.fn().mockResolvedValue(''),
      getSecret
    );
    getSecret.mockResolvedValue('supersecretkey');
    const result = await service.translate({ text: 'hi', target: 'es' });
    expect(result.engine).toBe('deepl');
    expect(result.source).toBe('en');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const deeplInit = fetchMock.mock.calls[1][1];
    expect(deeplInit.headers.Authorization).toBe('DeepL-Auth-Key supersecretkey');
  });

  it('never leaks key material through aggregated failure messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = makeService(
      configWith({
        translation: {
          mode: 'service',
          providers: [{ id: 'srv2', name: 'DeepL', type: 'deepl', enabled: true, keyHint: 'abcd…' }],
        },
      }),
      vi.fn().mockResolvedValue(''),
      getSecret
    );
    getSecret.mockResolvedValue('supersecretkey');
    const error = await service.translate({ text: 'hi', target: 'es' }).catch((cause: Error) => cause);
    expect(error.message).not.toContain('supersecretkey');
  });
});
