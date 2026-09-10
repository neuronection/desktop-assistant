import type { SearchProviderConfig, WebSearchResultItem } from '@shared/search';

export type FetchImpl = typeof fetch;

export const SEARCH_MAX_RESULTS_CAP = 10;
export const SEARCH_DEFAULT_MAX_RESULTS = 5;

export function clampResultCount(count: number | undefined): number {
  const n = Math.round(count ?? SEARCH_DEFAULT_MAX_RESULTS);
  return Math.min(SEARCH_MAX_RESULTS_CAP, Math.max(1, Number.isFinite(n) ? n : SEARCH_DEFAULT_MAX_RESULTS));
}

export function assertHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must be an http(s) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not embed credentials.`);
  }
  return url;
}

/** Joins a provider base URL with an endpoint path, preserving base path segments. */
export function joinUrl(base: string, path: string): URL {
  const url = assertHttpUrl(base, 'Base URL');
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return new URL(path, url);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('unexpected payload');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${response.status}: non-JSON response (${body.slice(0, 120)})`);
  }
}

function item(value: unknown): WebSearchResultItem | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url : typeof record.link === 'string' ? record.link : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }
  const title = typeof record.title === 'string' ? record.title : url;
  const snippet =
    typeof record.content === 'string'
      ? record.content
      : typeof record.snippet === 'string'
        ? record.snippet
        : typeof record.description === 'string'
          ? record.description
          : typeof record.text === 'string'
            ? record.text
            : '';
  return { title, url, snippet: snippet.slice(0, 400) };
}

function toItems(payload: Record<string, unknown>, listKey: string): WebSearchResultItem[] {
  const list = payload[listKey];
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map(item).filter((value): value is WebSearchResultItem => value !== null);
}

export interface ProviderRequestArgs {
  config: SearchProviderConfig;
  key: string | null;
  query: string;
  maxResults: number;
  signal: AbortSignal;
  fetchImpl?: FetchImpl;
}

export type ProviderFetcher = (args: ProviderRequestArgs) => Promise<WebSearchResultItem[]>;

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new Error(`HTTP ${response.status} — check the stored API key. ${body.slice(0, 120)}`);
    }
    if (response.status === 429) {
      throw new Error(`HTTP 429 — rate limited. ${body.slice(0, 120)}`);
    }
    throw new Error(`HTTP ${response.status} ${response.statusText}. ${body.slice(0, 120)}`);
  }
  return readJson(response);
}

async function fetchSearxng({ config, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!config.baseUrl) {
    throw new Error('SearXNG needs a base URL in the instance settings.');
  }
  const url = joinUrl(config.baseUrl, 'search');
  url.search = new URLSearchParams({ q: query, format: 'json' }).toString();
  const payload = await fetchJson(url.toString(), { signal, headers: { Accept: 'application/json' } }, fetchImpl);
  const results = toItems(payload, 'results');
  if (results.length === 0 && typeof payload.error === 'string') {
    throw new Error(String(payload.error).slice(0, 200));
  }
  return results.slice(0, maxResults);
}

async function fetchBrave({ config, key, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!key) {
    throw new Error('Brave Search needs an API key.');
  }
  const url = joinUrl(config.baseUrl ?? 'https://api.search.brave.com/res/v1', 'web/search');
  url.search = new URLSearchParams({ q: query, count: String(maxResults) }).toString();
  const payload = await fetchJson(
    url.toString(),
    { signal, headers: { Accept: 'application/json', 'X-Subscription-Token': key } },
    fetchImpl
  );
  const web = payload.web;
  const webRecord = (typeof web === 'object' && web !== null ? web : {}) as Record<string, unknown>;
  return toItems(webRecord, 'results').slice(0, maxResults);
}

async function fetchTavily({ config, key, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!key) {
    throw new Error('Tavily needs an API key.');
  }
  const url = joinUrl(config.baseUrl ?? 'https://api.tavily.com', 'search');
  const payload = await fetchJson(
    url.toString(),
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: maxResults }),
    },
    fetchImpl
  );
  return toItems(payload, 'results').slice(0, maxResults);
}

async function fetchExa({ config, key, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!key) {
    throw new Error('Exa needs an API key.');
  }
  const url = joinUrl(config.baseUrl ?? 'https://api.exa.ai', 'search');
  const payload = await fetchJson(
    url.toString(),
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query, numResults: maxResults, contents: { text: { maxCharacters: 400 } } }),
    },
    fetchImpl
  );
  return toItems(payload, 'results').slice(0, maxResults);
}

async function fetchSerper({ config, key, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!key) {
    throw new Error('Serper needs an API key.');
  }
  const url = joinUrl(config.baseUrl ?? 'https://google.serper.dev', 'search');
  const payload = await fetchJson(
    url.toString(),
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: maxResults }),
    },
    fetchImpl
  );
  return toItems(payload, 'organic').slice(0, maxResults);
}

async function fetchGooglePse({ config, key, query, maxResults, signal, fetchImpl = fetch }: ProviderRequestArgs): Promise<WebSearchResultItem[]> {
  if (!key) {
    throw new Error('Google Programmable Search needs an API key.');
  }
  if (!config.googleCx) {
    throw new Error('Google Programmable Search needs an engine id (cx) in the instance settings.');
  }
  const url = new URL(config.baseUrl ?? 'https://www.googleapis.com/customsearch/v1');
  url.search = new URLSearchParams({ key, cx: config.googleCx, q: query, num: String(maxResults) }).toString();
  const payload = await fetchJson(url.toString(), { signal }, fetchImpl);
  return toItems(payload, 'items').slice(0, maxResults);
}

export const SEARCH_FETCHERS: Record<SearchProviderConfig['type'], ProviderFetcher> = {
  searxng: fetchSearxng,
  brave: fetchBrave,
  tavily: fetchTavily,
  exa: fetchExa,
  serper: fetchSerper,
  'google-pse': fetchGooglePse,
};
