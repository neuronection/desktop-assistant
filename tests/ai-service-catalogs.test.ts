import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/da-test-data' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buf: Buffer) => buf.toString().slice(4),
  },
}));

const secretState = vi.hoisted(() => ({ has: true }));

vi.mock('@main/services/SecretService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/SecretService')>();
  return {
    ...actual,
    SecretService: {
      ...actual.SecretService,
      getInstance: () => ({
        getSecret: vi.fn(async () => 'sk-stored'),
        hasSecret: vi.fn(async () => secretState.has),
      }),
    },
  };
});

import { AIService } from '@main/services/AIService';
import { LLMProviderType } from '@shared/types';

const provider = (type: LLMProviderType, apiBase: string): Parameters<AIService['fetchAvailableModels']>[0] => ({
  id: 'p1',
  name: 'Test',
  type,
  apiKey: '',
  apiBase,
});

beforeEach(() => {
  vi.unstubAllGlobals();
  secretState.has = true;
});

describe('AIService remote catalogs', () => {
  it('rejects with a clear error instead of an empty list when the key is missing', async () => {
    secretState.has = false;
    const service = new AIService();
    await expect(service.fetchAvailableModels(provider(LLMProviderType.OPENAI, 'https://api.test/v1'))).rejects.toThrow(
      /is not set/
    );
  });

  it('lists anthropic models with the required headers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new AIService();
    const models = await service.fetchAvailableModels(provider(LLMProviderType.ANTHROPIC, 'https://api.anthropic.com'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'sk-stored', 'anthropic-version': '2023-06-01' });
    expect(models).toEqual([
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', providerType: LLMProviderType.ANTHROPIC, providerId: 'p1' },
    ]);
  });

  it('lists google models keyed by query parameter, stripping the models/ prefix', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new AIService();
    const models = await service.fetchAvailableModels(
      provider(LLMProviderType.GOOGLE, 'https://generativelanguage.googleapis.com/v1beta')
    );

    expect(fetchMock.mock.calls[0][0]).toContain('models?key=sk-stored');
    expect(models).toEqual([
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', providerType: LLMProviderType.GOOGLE, providerId: 'p1' },
    ]);
  });

  it('lists ollama models from the native tags endpoint, stripping the openai-compatible /v1 suffix', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new AIService();
    const models = await service.fetchAvailableModels(provider(LLMProviderType.OLLAMA, 'http://localhost:11434/v1'));

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    expect(models).toEqual([
      { id: 'llama3.2:latest', name: 'llama3.2:latest', providerType: LLMProviderType.OLLAMA, providerId: 'p1' },
    ]);
  });

  it('lists ollama models when the apiBase has no /v1 suffix', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new AIService();
    const models = await service.fetchAvailableModels(provider(LLMProviderType.OLLAMA, 'http://localhost:11434/'));

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    expect(models).toEqual([
      { id: 'qwen2.5:7b', name: 'qwen2.5:7b', providerType: LLMProviderType.OLLAMA, providerId: 'p1' },
    ]);
  });
});
