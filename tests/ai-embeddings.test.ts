import { describe, it, expect, vi, afterEach } from 'vitest';

import { embedTexts, EmbeddingsError } from '@main/ai/embeddings';
import { LLMProvider, LLMProviderType } from '@shared/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const makeProvider = (overrides: Partial<LLMProvider> = {}): LLMProvider => ({
  id: 'p1',
  name: 'OpenAI',
  type: LLMProviderType.OPENAI,
  apiKey: 'sk-secret-key',
  apiBase: 'https://api.openai.com/v1',
  timeout: 5000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  availableModels: [],
  customModels: [],
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('embedTexts (plan 26 embeddings transport)', () => {
  it('posts the OpenAI-compatible /embeddings shape and returns the vectors in order', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }, { index: 1, embedding: [0.3, 0.4] }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const vectors = await embedTexts(makeProvider(), 'text-embedding-3-small', ['hello', 'world']);

    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ model: 'text-embedding-3-small', input: ['hello', 'world'] });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-key');
  });

  it('reorders vectors when a compatible server returns shuffled indices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ index: 1, embedding: [3] }, { index: 0, embedding: [1] }] }))
    );

    const vectors = await embedTexts(makeProvider(), 'm', ['a', 'b']);

    expect(vectors).toEqual([[1], [3]]);
  });

  it('posts one embedContent call per input for Google providers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ embedding: { values: [0.5, 0.6] } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = makeProvider({
      type: LLMProviderType.GOOGLE,
      apiBase: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza-secret',
    });

    const vectors = await embedTexts(provider, 'gemini-embedding-2', ['a', 'b']);

    expect(vectors).toEqual([[0.5, 0.6], [0.5, 0.6]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=AIza-secret'
    );
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ content: { parts: [{ text: 'b' }] } });
  });

  it('returns an empty vector list for empty inputs without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const vectors = await embedTexts(makeProvider(), 'text-embedding-3-small', []);

    expect(vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies vendor failures through classifyProviderError (401 → invalid_key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'Incorrect API key' } }, 401)));

    const error = await embedTexts(makeProvider(), 'text-embedding-3-small', ['x']).catch((e: EmbeddingsError) => e);

    expect(error).toBeInstanceOf(EmbeddingsError);
    expect(error.code).toBe('invalid_key');
  });

  it('classifies a refused local connection as local_not_running for ollama', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:11434');
      })
    );

    const error = await embedTexts(
      makeProvider({ type: LLMProviderType.OLLAMA, apiBase: 'http://localhost:11434/v1', apiKey: '' }),
      'nomic-embed-text',
      ['x']
    ).catch((e: EmbeddingsError) => e);

    expect(error.code).toBe('local_not_running');
  });

  it('classifies an abort as timeout (the provider timeout)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
      )
    );

    // handler attached at creation — the rejection settles inside the
    // fake-timer flush, before an `await expect(...).rejects` could attach
    const tracked = embedTexts(makeProvider({ timeout: 5000 }), 'text-embedding-3-small', ['x']).then(
      () => null,
      (error: EmbeddingsError) => error
    );
    await vi.advanceTimersByTimeAsync(5001);
    const error = await tracked;

    expect(error?.code).toBe('timeout');
  });

  it('never leaks the key — vendor-echoed key material is scrubbed from the thrown message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'bad key: sk-secret-key please fix' } }, 401))
    );

    const error = await embedTexts(makeProvider(), 'text-embedding-3-small', ['x']).catch((e: EmbeddingsError) => e);

    expect(error.message).not.toContain('sk-secret-key');
    expect(error.message).toContain('[redacted]');
  });

  it('scrubs the key even when the full Google URL (query param included) lands in an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        throw new TypeError(`fetch failed for ${String(url)}`);
      })
    );
    const provider = makeProvider({
      type: LLMProviderType.GOOGLE,
      apiBase: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza-secret',
    });

    const error = await embedTexts(provider, 'gemini-embedding-2', ['x']).catch((e: EmbeddingsError) => e);

    expect(error.message).not.toContain('AIza-secret');
  });

  it('rejects provider types without an embeddings surface without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await embedTexts(makeProvider({ type: LLMProviderType.ANTHROPIC }), 'whatever', ['x']).catch(
      (e: EmbeddingsError) => e
    );

    expect(error.code).toBe('unknown');
    expect(error.message).toContain('does not serve embeddings');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
