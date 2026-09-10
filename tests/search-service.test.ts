import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfig, updateConfig, getSecret, setSecret, deleteSecret } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({ getConfig, updateConfig }) },
}));

vi.mock('@main/services/SecretService', () => ({
  SecretService: {
    getInstance: () => ({ getSecret, setSecret, deleteSecret }),
    keyHint: (value: string) => `…${value.slice(-4)}`,
  },
}));

import { SearchService, searchProviderSecretKey } from '@main/services/SearchService';
import type { SearchProviderConfig } from '@shared/search';

const searxng: SearchProviderConfig = {
  id: 's1',
  name: 'Home SearXNG',
  type: 'searxng',
  enabled: true,
  baseUrl: 'http://home:8080',
};

const brave: SearchProviderConfig = {
  id: 'b1',
  name: 'Brave',
  type: 'brave',
  enabled: true,
  keyHint: '…abcd',
};

const freshService = (): SearchService => {
  (SearchService as unknown as { instance: SearchService | undefined }).instance = undefined;
  return SearchService.getInstance();
};

const fetchJsonOk = (body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  getConfig.mockReturnValue({ search: { providers: [searxng, brave] } });
  getSecret.mockResolvedValue('stored-key');
});

describe('SearchService CRUD', () => {
  it('lists providers with masked keys only', () => {
    const views = freshService().listProviders();
    expect(views).toHaveLength(2);
    expect(views[1]).toMatchObject({ hasKey: true });
    expect(JSON.stringify(views)).not.toContain('stored-key');
  });

  it('routes new key material to the keyring and stores only a hint', async () => {
    const svc = freshService();
    await svc.saveProvider({
      id: 't1',
      name: 'Tavily',
      type: 'tavily',
      enabled: true,
      key: 'tvly-secret-9876',
    });
    expect(setSecret).toHaveBeenCalledWith(searchProviderSecretKey('t1'), 'tvly-secret-9876');
    const persisted = updateConfig.mock.calls[0][0].search.providers as SearchProviderConfig[];
    expect(persisted.find((provider) => provider.id === 't1')?.keyHint).toBe('…9876');
    expect(JSON.stringify(updateConfig.mock.calls)).not.toContain('tvly-secret-9876');
  });

  it('empty key clears the stored secret and the hint', async () => {
    const svc = freshService();
    await svc.saveProvider({ ...brave, key: '' });
    expect(deleteSecret).toHaveBeenCalledWith(searchProviderSecretKey('b1'));
    const persisted = updateConfig.mock.calls[0][0].search.providers as SearchProviderConfig[];
    expect(persisted.find((provider) => provider.id === 'b1')?.keyHint).toBeUndefined();
  });

  it('rejects a searxng instance without a base URL', async () => {
    const svc = freshService();
    await expect(svc.saveProvider({ id: 's2', name: 'x', type: 'searxng', enabled: true })).rejects.toThrow(/base URL/i);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('delete removes the config entry and the keyring secret', async () => {
    await freshService().deleteProvider('b1');
    const persisted = updateConfig.mock.calls[0][0].search.providers as SearchProviderConfig[];
    expect(persisted.map((provider) => provider.id)).toEqual(['s1']);
    expect(deleteSecret).toHaveBeenCalledWith(searchProviderSecretKey('b1'));
  });

  it('moveProvider swaps array order and persists it', async () => {
    await freshService().moveProvider('b1', 'up');
    const persisted = updateConfig.mock.calls[0][0].search.providers as SearchProviderConfig[];
    expect(persisted.map((provider) => provider.id)).toEqual(['b1', 's1']);
    await expect(freshService().moveProvider('s1', 'up')).resolves.toBe(false);
  });
});

describe('SearchService ordered failover', () => {
  it('returns the first provider that answers and names it', async () => {
    const svc = freshService();
    const first = fetchJsonOk({ results: [{ title: 'A', url: 'https://a.example', content: 'sa' }] });
    const second = fetchJsonOk({ web: { results: [{ title: 'B', url: 'https://b.example', description: 'sb' }] } });
    const impl = vi.fn((url: string | URL) => (String(url).includes('home:8080') ? first(String(url)) : second(String(url))));
    const outcome = await svc.search('query', 5, impl as unknown as typeof fetch);
    expect(outcome.ok).toBe(true);
    expect(outcome.provider).toBe('Home SearXNG');
    expect(outcome.items[0]?.url).toBe('https://a.example');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('falls over to the next provider and reports the failures', async () => {
    getConfig.mockReturnValue({ search: { providers: [searxng, brave] } });
    const svc = freshService();
    const impl = vi.fn((url: string | URL, init?: RequestInit) => {
      if (String(url).includes('home:8080')) {
        return Promise.resolve(new Response('Forbidden', { status: 403 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ web: { results: [{ title: 'B', url: 'https://b.example', description: 'sb' }] } }), { status: 200 }));
    });
    const outcome = await svc.search('query', 5, impl as unknown as typeof fetch);
    expect(outcome.ok).toBe(true);
    expect(outcome.provider).toBe('Brave');
    expect(outcome.errors?.[0]).toMatch(/Home SearXNG: HTTP 403/);
  });

  it('collects every error when all providers fail', async () => {
    const svc = freshService();
    const outcome = await svc.search('query', 5, (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toHaveLength(2);
    expect(outcome.errors?.every((message) => /HTTP 500/.test(message))).toBe(true);
  });

  it('reports an unavailable tool when nothing is configured', async () => {
    getConfig.mockReturnValue({ search: { providers: [] } });
    const outcome = await freshService().search('query');
    expect(outcome.ok).toBe(false);
    expect(outcome.errors?.[0]).toMatch(/No web-search providers/);
  });

  it('resolves keys at call time and only for providers with a hint', async () => {
    const svc = freshService();
    const impl = vi.fn(async (url: string | URL) => {
      if (String(url).includes('home:8080')) {
        return new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://a.example', content: 'sa' }] }), { status: 200 });
      }
      throw new Error('should not be called');
    });
    await svc.search('query', 5, impl as unknown as typeof fetch);
    expect(getSecret).toHaveBeenCalledTimes(0);
  });

  it('testProvider returns count and latency on success', async () => {
    const svc = freshService();
    const impl = vi.fn(async () => new Response(JSON.stringify({ results: [{ title: 'A', url: 'https://a.example', content: 's' }] }), { status: 200 }));
    const result = await svc.testProvider('s1', impl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.resultCount).toBe(1);
    expect(typeof result.latencyMs).toBe('number');
  });
});
