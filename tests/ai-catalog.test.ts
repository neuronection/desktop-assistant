import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fetchProviderCatalog } from '@main/ai/catalog';
import { LLMProviderType } from '@shared/types';

const provider = (type: LLMProviderType, apiBase: string) => ({
  id: 'p1',
  name: 'Test',
  type,
  apiKey: '',
  apiBase,
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('ai/catalog per-provider branches (ADR-0018)', () => {
  it('lists openai-compatible models from /models with a bearer header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-5.5-mini' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchProviderCatalog(provider(LLMProviderType.OPENAI, 'https://api.test/v1'), 'sk-direct');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v1/models');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-direct' });
    expect(models).toEqual([
      { id: 'gpt-5.5', name: 'gpt-5.5', providerType: LLMProviderType.OPENAI, providerId: 'p1' },
      { id: 'gpt-5.5-mini', name: 'gpt-5.5-mini', providerType: LLMProviderType.OPENAI, providerId: 'p1' },
    ]);
  });

  it('maps non-ok responses to an error carrying the status and body', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchProviderCatalog(provider(LLMProviderType.OPENAI, 'https://api.test/v1'), 'sk')).rejects.toThrow(
      /status 403: forbidden/
    );
  });

  it('returns an empty list for provider types with no catalog branch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const models = await fetchProviderCatalog(provider('custom' as LLMProviderType, 'https://api.test'), '');
    expect(models).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Model fetching not implemented'));
    warn.mockRestore();
  });

  it('keeps the anthropic default base when apiBase is empty', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'claude-opus-4-6' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchProviderCatalog(provider(LLMProviderType.ANTHROPIC, ''), 'sk-x');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/models');
  });

  it('keeps the google default v1beta base when apiBase is empty', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-3-flash' }] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchProviderCatalog(provider(LLMProviderType.GOOGLE, ''), 'sk-x');
    expect(fetchMock.mock.calls[0][0]).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models?key=sk-x'
    );
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gemini-3-flash');
  });
});
