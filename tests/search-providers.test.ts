import { describe, it, expect, vi } from 'vitest';
import {
  SEARCH_FETCHERS,
  clampResultCount,
  assertHttpUrl,
  type ProviderRequestArgs,
} from '@main/services/search-providers';
import type { SearchProviderConfig } from '@shared/search';

const baseConfig: SearchProviderConfig = {
  id: 'p1',
  name: 'test',
  type: 'searxng',
  enabled: true,
};

function jsonBody(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function args(overrides: Partial<ProviderRequestArgs> = {}): ProviderRequestArgs & { fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn();
  return {
    config: baseConfig,
    key: null,
    query: 'test query',
    maxResults: 5,
    signal: new AbortController().signal,
    fetchImpl,
    ...overrides,
    fetchImpl,
  } as ProviderRequestArgs & { fetchImpl: ReturnType<typeof vi.fn> };
}

describe('clampResultCount', () => {
  it('clamps to 1–10 and defaults to 5', () => {
    expect(clampResultCount(undefined)).toBe(5);
    expect(clampResultCount(0)).toBe(1);
    expect(clampResultCount(99)).toBe(10);
    expect(clampResultCount(3.6)).toBe(4);
  });
});

describe('assertHttpUrl', () => {
  it('rejects non-http and credential-embedded URLs', () => {
    expect(() => assertHttpUrl('ftp://x', 'Base URL')).toThrow(/http\(s\)/);
    expect(() => assertHttpUrl('http://user:pass@host', 'Base URL')).toThrow(/credentials/);
    expect(() => assertHttpUrl('not a url', 'Base URL')).toThrow(/not a valid URL/);
    expect(assertHttpUrl('http://192.168.1.10:8080', 'Base URL').hostname).toBe('192.168.1.10');
  });
});

describe('provider fetchers', () => {
  it('searxng queries {base}/search with format=json and maps results', async () => {
    const a = args({
      config: { ...baseConfig, type: 'searxng', baseUrl: 'http://home:8080' },
    });
    a.fetchImpl.mockResolvedValue(jsonBody({ results: [
      { title: 'Result', url: 'https://x.example', content: 'snippet text' },
      { title: 'No url' },
    ] }));
    const items = await SEARCH_FETCHERS.searxng(a);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ title: 'Result', url: 'https://x.example', snippet: 'snippet text' });
    const [url, init] = a.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://home:8080/search?q=test+query&format=json');
    expect(init.signal).toBe(a.signal);
  });

  it('searxng explains a disabled JSON API', async () => {
    const a = args({ config: { ...baseConfig, type: 'searxng', baseUrl: 'http://home:8080' } });
    a.fetchImpl.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    await expect(SEARCH_FETCHERS.searxng(a)).rejects.toThrow(/HTTP 403/);
  });

  it('searxng requires a base URL', async () => {
    await expect(SEARCH_FETCHERS.searxng(args())).rejects.toThrow(/base URL/i);
  });

  it('brave sends the subscription token and maps web.results', async () => {
    const a = args({
      config: { ...baseConfig, type: 'brave' },
      key: 'brave-key',
    });
    a.fetchImpl.mockResolvedValue(jsonBody({ web: { results: [{ title: 'B', url: 'https://b.example', description: 'desc' }] } }));
    const items = await SEARCH_FETCHERS.brave(a);
    expect(items[0]).toEqual({ title: 'B', url: 'https://b.example', snippet: 'desc' });
    const [url, init] = a.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.search.brave.com/res/v1/web/search?q=test+query&count=5');
    expect(init.headers['X-Subscription-Token']).toBe('brave-key');
  });

  it('brave refuses to run without a key', async () => {
    await expect(SEARCH_FETCHERS.brave(args({ config: { ...baseConfig, type: 'brave' } }))).rejects.toThrow(/API key/);
  });

  it('tavily posts the bearer-authenticated query body', async () => {
    const a = args({ config: { ...baseConfig, type: 'tavily' }, key: 'tvly-key' });
    a.fetchImpl.mockResolvedValue(jsonBody({ results: [{ title: 'T', url: 'https://t.example', content: 'c' }] }));
    const items = await SEARCH_FETCHERS.tavily(a);
    expect(items).toHaveLength(1);
    const [url, init] = a.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tvly-key');
    expect(JSON.parse(init.body)).toEqual({ query: 'test query', max_results: 5 });
  });

  it('exa posts numResults with the x-api-key header', async () => {
    const a = args({ config: { ...baseConfig, type: 'exa' }, key: 'exa-key', maxResults: 3 });
    a.fetchImpl.mockResolvedValue(jsonBody({ results: [{ title: 'E', url: 'https://e.example', text: 't' }] }));
    const items = await SEARCH_FETCHERS.exa(a);
    expect(items).toHaveLength(1);
    const [url, init] = a.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://api.exa.ai/search');
    expect(init.headers['x-api-key']).toBe('exa-key');
    expect(JSON.parse(init.body).numResults).toBe(3);
  });

  it('serper maps organic results through the X-API-KEY header', async () => {
    const a = args({ config: { ...baseConfig, type: 'serper' }, key: 'serper-key' });
    a.fetchImpl.mockResolvedValue(jsonBody({ organic: [{ title: 'S', link: 'https://s.example', snippet: 'sn' }] }));
    const items = await SEARCH_FETCHERS.serper(a);
    expect(items[0]).toEqual({ title: 'S', url: 'https://s.example', snippet: 'sn' });
    const [url, init] = a.fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://google.serper.dev/search');
    expect(init.headers['X-API-KEY']).toBe('serper-key');
    expect(JSON.parse(init.body)).toEqual({ q: 'test query', num: 5 });
  });

  it('google-pse sends key, cx and maps items', async () => {
    const a = args({ config: { ...baseConfig, type: 'google-pse', googleCx: 'cx-123' }, key: 'g-key' });
    a.fetchImpl.mockResolvedValue(jsonBody({ items: [{ title: 'G', link: 'https://g.example', snippet: 'gs' }] }));
    const items = await SEARCH_FETCHERS['google-pse'](a);
    expect(items[0]).toEqual({ title: 'G', url: 'https://g.example', snippet: 'gs' });
    const url = String(a.fetchImpl.mock.calls[0][0]);
    expect(url).toContain('https://www.googleapis.com/customsearch/v1?');
    expect(url).toContain('key=g-key');
    expect(url).toContain('cx=cx-123');
    expect(url).toContain('num=5');
  });

  it('google-pse requires cx and key', async () => {
    await expect(SEARCH_FETCHERS['google-pse'](args({ config: { ...baseConfig, type: 'google-pse' } }))).rejects.toThrow(/API key/);
    const a = args({ config: { ...baseConfig, type: 'google-pse', googleCx: 'cx' }, key: 'k' });
    a.fetchImpl.mockResolvedValue(jsonBody({ items: [] }));
    await expect(SEARCH_FETCHERS['google-pse'](a)).resolves.toEqual([]);
  });

  it('maps HTTP 401 to a key hint and 429 to rate limiting', async () => {
    const a = args({ config: { ...baseConfig, type: 'brave' }, key: 'k' });
    a.fetchImpl.mockResolvedValue(new Response('nope', { status: 401 }));
    await expect(SEARCH_FETCHERS.brave(a)).rejects.toThrow(/check the stored API key/);
    const b = args({ config: { ...baseConfig, type: 'brave' }, key: 'k' });
    b.fetchImpl.mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(SEARCH_FETCHERS.brave(b)).rejects.toThrow(/rate limited/i);
  });
});
