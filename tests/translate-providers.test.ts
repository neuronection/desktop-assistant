import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEEPL_DEFAULT_API_BASE,
  DEEPL_FREE_API_BASE,
  TRANSLATION_RESULT_CHAR_CAP,
  capTranslation,
  translateWithDeepl,
  translateWithLibretranslate,
} from '@main/ai/translate';
import { setAuditSink, setAiAuditClientProvider, type AiCallRecord } from '@main/ai/audit';
import type { TranslationProviderConfig } from '@shared/translation';

const deeplConfig = (overrides: Partial<TranslationProviderConfig> = {}): TranslationProviderConfig => ({
  id: 'srv-deepl',
  name: 'DeepL',
  type: 'deepl',
  enabled: true,
  ...overrides,
});

const ltConfig = (overrides: Partial<TranslationProviderConfig> = {}): TranslationProviderConfig => ({
  id: 'srv-lt',
  name: 'Local LibreTranslate',
  type: 'libretranslate',
  enabled: true,
  apiBase: 'http://lt.local',
  ...overrides,
});

const json = (body: string, status = 200) => new Response(body, { status });

describe('translateWithDeepl', () => {
  it('posts the text array with an uppercase target and returns the translation + detection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(JSON.stringify({ translations: [{ text: 'Hola', detected_source_language: 'EN' }] }))
    );
    const outcome = await translateWithDeepl({
      config: deeplConfig(),
      key: 'auth-key',
      text: 'hello',
      target: 'es',
      source: 'en',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`${DEEPL_DEFAULT_API_BASE}/v2/translate`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('DeepL-Auth-Key auth-key');
    expect(JSON.parse(init.body)).toEqual({ text: ['hello'], target_lang: 'ES', source_lang: 'EN' });
    expect(outcome).toEqual({ text: 'Hola', engine: 'deepl', source: 'en' });
  });

  it('routes free-tier keys (…:fx) to the free endpoint unless a base URL is set', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(json(JSON.stringify({ translations: [{ text: 'Hola' }] }))));
    await translateWithDeepl({
      config: deeplConfig(),
      key: 'abcd1234:fx',
      text: 'hello',
      target: 'es',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${DEEPL_FREE_API_BASE}/v2/translate`);

    await translateWithDeepl({
      config: deeplConfig({ apiBase: 'https://proxy.local/deepl' }),
      key: 'abcd1234:fx',
      text: 'hello',
      target: 'es',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://proxy.local/deepl/v2/translate');
  });

  it('maps auth, quota and empty-translation failures to typed errors', async () => {
    await expect(
      translateWithDeepl({ config: deeplConfig(), key: null, text: 'hello', target: 'es' })
    ).rejects.toThrow(/DeepL needs an API key/);

    const auth = vi.fn().mockResolvedValue(json('{}', 403));
    await expect(
      translateWithDeepl({ config: deeplConfig(), key: 'k', text: 'hello', target: 'es', fetchImpl: auth as unknown as typeof fetch })
    ).rejects.toThrow(/rejected the API key/);

    const quota = vi.fn().mockResolvedValue(json('{}', 456));
    await expect(
      translateWithDeepl({ config: deeplConfig(), key: 'k', text: 'hello', target: 'es', fetchImpl: quota as unknown as typeof fetch })
    ).rejects.toThrow(/quota exceeded/);

    const empty = vi.fn().mockResolvedValue(json(JSON.stringify({ translations: [] })));
    await expect(
      translateWithDeepl({ config: deeplConfig(), key: 'k', text: 'hello', target: 'es', fetchImpl: empty as unknown as typeof fetch })
    ).rejects.toThrow(/returned no translation/);
  });
});

describe('translateWithLibretranslate', () => {
  it('posts auto source and the api key when present, returning detection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json(JSON.stringify({ detectedLanguage: { confidence: 0.9, language: 'de' }, translatedText: 'Bonjour' }))
    );
    const outcome = await translateWithLibretranslate({
      config: ltConfig(),
      key: 'lt-key',
      text: 'guten tag',
      target: 'fr',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://lt.local/translate');
    expect(JSON.parse(init.body)).toEqual({ q: 'guten tag', source: 'auto', target: 'fr', format: 'text', api_key: 'lt-key' });
    expect(outcome).toEqual({ text: 'Bonjour', engine: 'libretranslate', source: 'de' });
  });

  it('omits detection when the source was pinned and the key when keyless', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(JSON.stringify({ translatedText: 'Bonjour' })));
    const outcome = await translateWithLibretranslate({
      config: ltConfig(),
      key: null,
      text: 'guten tag',
      target: 'fr',
      source: 'de',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ q: 'guten tag', source: 'de', target: 'fr', format: 'text' });
    expect(outcome).toEqual({ text: 'Bonjour', engine: 'libretranslate' });
  });

  it('requires a server URL and surfaces payload errors', async () => {
    await expect(
      translateWithLibretranslate({ config: ltConfig({ apiBase: undefined }), key: null, text: 'hi', target: 'fr' })
    ).rejects.toThrow(/needs a server URL/);

    const denied = vi.fn().mockResolvedValue(json(JSON.stringify({ error: 'Please contact the server operator.' }), 403));
    await expect(
      translateWithLibretranslate({ config: ltConfig(), key: 'k', text: 'hi', target: 'fr', fetchImpl: denied as unknown as typeof fetch })
    ).rejects.toThrow(/contact the server operator/);

    const malformed = vi.fn().mockResolvedValue(json('<html>oops</html>'));
    await expect(
      translateWithLibretranslate({ config: ltConfig(), key: 'k', text: 'hi', target: 'fr', fetchImpl: malformed as unknown as typeof fetch })
    ).rejects.toThrow(/non-JSON response/);
  });
});

describe('capTranslation + service-engine audit rows', () => {
  const records: AiCallRecord[] = [];

  beforeEach(() => {
    records.length = 0;
    setAuditSink(async (record) => {
      records.push(record);
    });
    setAiAuditClientProvider(() => null);
  });

  afterEach(() => {
    setAuditSink(async () => undefined);
  });

  it('caps over-long translations', () => {
    expect(capTranslation('  x  ')).toBe('x');
    expect(capTranslation('y'.repeat(TRANSLATION_RESULT_CHAR_CAP + 50)).length).toBe(TRANSLATION_RESULT_CHAR_CAP);
  });

  it('writes ok and error AiCall rows for service-engine calls', async () => {
    const ok = vi.fn().mockResolvedValue(json(JSON.stringify({ translatedText: 'Hola' })));
    await translateWithLibretranslate({
      config: ltConfig(),
      key: null,
      text: 'hi',
      target: 'es',
      fetchImpl: ok as unknown as typeof fetch,
    });
    const failing = vi.fn().mockResolvedValue(json('{}', 403));
    await expect(
      translateWithLibretranslate({ config: ltConfig(), key: 'k', text: 'hi', target: 'es', fetchImpl: failing as unknown as typeof fetch })
    ).rejects.toThrow();

    await vi.waitFor(() => {
      expect(records).toHaveLength(2);
    });
    expect(records[0]).toMatchObject({ task: 'translate', providerId: 'srv-lt', model: 'libretranslate', outcome: 'ok' });
    expect(records[1]).toMatchObject({ task: 'translate', providerId: 'srv-lt', model: 'libretranslate', outcome: 'error' });
    expect(records[0]).not.toHaveProperty('text');
  });
});
