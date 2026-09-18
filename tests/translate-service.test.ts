import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSecret } = vi.hoisted(() => ({
  getSecret: vi.fn(),
}));

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({}) },
}));

vi.mock('@main/services/SecretService', () => ({
  SecretService: { getInstance: () => ({ getSecret }) },
  providerSecretKey: (id: string) => `provider:${id}`,
}));

import { TranslateService, translationProviderSecretKey } from '@main/services/TranslateService';
import { TRANSLATION_FETCHERS } from '@main/ai/translate';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';
import type { TranslationSettings } from '@shared/translation';

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
) => new TranslateService({ configService: { getConfig: () => config }, gateway: { invoke }, getSecret: secret });

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
    expect(result).toEqual({ text: 'Hola', engine: 'llm' });
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
    expect(result).toEqual({ text: 'Καλημέρα', engine: 'llm' });
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
    expect(result).toEqual({ text: 'Χαῖρε', engine: 'llm' });
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
    delete TRANSLATION_FETCHERS.libretranslate;
    delete TRANSLATION_FETCHERS.deepl;
  });

  it('mode llm: unassigned task errors without touching services', async () => {
    const service = makeService(configWith({ translation: { mode: 'llm' } }));
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/No translation model is assigned/);
  });

  it('mode service: reports provider errors with names when the engine cannot run', async () => {
    const service = makeService(
      configWith({ translation: { mode: 'service', providers: [{ id: 'srv1', name: 'DeepL', type: 'deepl', enabled: true }] } })
    );
    await expect(service.translate({ text: 'hi', target: 'el' })).rejects.toThrow(/DeepL: .*not available/);
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
      expect.objectContaining({ key: 'srv-key', text: 'hi', target: 'es', signal: controller.signal })
    );
    expect(result).toEqual({ text: 'Hola', engine: 'libretranslate', source: 'en' });
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
    expect(result).toEqual({ text: 'Hola', engine: 'libretranslate' });
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
