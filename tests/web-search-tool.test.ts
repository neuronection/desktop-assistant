import { describe, it, expect, vi, beforeEach } from 'vitest';

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn(),
}));

vi.mock('@main/services/SearchService', () => ({
  SearchService: { getInstance: () => ({ search: searchMock }) },
}));

import { webSearchTool } from '@main/ai/tools/native/web-search';

const exec = (args: unknown, signal?: AbortSignal): Promise<string> =>
  webSearchTool.exec(args as never, { signal }) as Promise<string>;

beforeEach(() => {
  searchMock.mockReset();
});

describe('web_search tool', () => {
  it('formats results as numbered markdown links with provider attribution', async () => {
    searchMock.mockResolvedValue({
      ok: true,
      items: [
        { title: 'First', url: 'https://a.example', snippet: 'alpha' },
        { title: 'Second', url: 'https://b.example', snippet: '' },
      ],
      provider: 'Home SearXNG',
    });
    const text = await exec({ query: 'news', maxResults: 2 });
    expect(text).toContain('Web results via Home SearXNG:');
    expect(text).toContain('1. [First](https://a.example) — alpha');
    expect(text).toContain('2. [Second](https://b.example)');
    expect(searchMock).toHaveBeenCalledWith('news', 2);
  });

  it('lists every provider error when the search fails', async () => {
    searchMock.mockResolvedValue({
      ok: false,
      items: [],
      errors: ['Home SearXNG: timed out after 8s.', 'Brave: HTTP 401 — check the stored API key.'],
    });
    const text = await exec({ query: 'news' });
    expect(text).toContain('Search failed on every configured provider');
    expect(text).toContain('timed out after 8s');
    expect(text).toContain('HTTP 401');
  });

  it('honours the abort signal of the turn', async () => {
    const controller = new AbortController();
    searchMock.mockImplementation(
      () => new Promise((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      })
    );
    const pending = exec({ query: 'news' }, controller.signal);
    controller.abort();
    await expect(pending).resolves.toContain('cancelled');
  });

  it('is a read-only network tool with a documented schema', () => {
    expect(webSearchTool.risk).toBe('read-only');
    expect(webSearchTool.category).toBe('network');
    const shape = (webSearchTool.schema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toEqual(['query', 'maxResults']);
  });
});
