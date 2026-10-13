/**
 * Family web-search contract parity wall (ADR-0035 / plan 28).
 *
 * Desktop's TS adapters must satisfy the SAME fixture suite as the vendored
 * Python core (contracts/search_providers.fixtures.json, dev canonical):
 * same requests out, same normalized hits (or the same error kind) in.
 * The fixtures are the cross-language acceptance suite — an implementation
 * may differ, its outputs may not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SearchProviderError,
  SEARCH_PROVIDER_TYPES,
  searchProviderUsesKey,
  type SearchProviderConfig,
  type WebSearchResultItem,
} from '@shared/search';
import { SEARCH_FETCHERS } from '../src/main/services/search-providers';

interface FixtureCase {
  id: string;
  config: Record<string, unknown>;
  query: string;
  api_key: string;
  request: null | {
    method: string;
    url: string;
    params?: Record<string, string>;
    auth_bearer?: string;
    header?: string;
    body_contains?: Record<string, unknown>;
  };
  response: null | {
    status: number;
    json?: Record<string, unknown>;
    text?: string;
    content_type?: string;
  };
  expected_hits?: Array<{ title: string; url: string; content: string }>;
  expected_error_kind?: string;
}

const FIXTURES: { cases: FixtureCase[] } = JSON.parse(
  readFileSync(join(__dirname, '..', 'contracts', 'search_providers.fixtures.json'), 'utf-8'),
);

function toDesktopConfig(raw: Record<string, unknown>): SearchProviderConfig {
  return {
    id: String(raw.id ?? 'sp'),
    name: String(raw.name ?? raw.type),
    type: String(raw.type) as SearchProviderConfig['type'],
    enabled: raw.enabled !== false,
    baseUrl: (raw.base_url as string | undefined) ?? undefined,
    googleCx: (raw.google_cx as string | undefined) ?? undefined,
  };
}

function fetchImplFor(case_: FixtureCase): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const requestSpec = case_.request;
    if (!requestSpec || !case_.response) {
      throw new Error(`${case_.id}: no request expected`);
    }
    expect(String(url).split('?')[0]).toBe(requestSpec.url);
    expect(init?.method ?? 'GET').toBe(requestSpec.method);
    const actualParams = new URL(String(url)).searchParams;
    for (const [key, value] of Object.entries(requestSpec.params ?? {})) {
      expect(actualParams.get(key)).toBe(value);
    }
    if (requestSpec.auth_bearer) {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(`Bearer ${requestSpec.auth_bearer}`);
    }
    for (const header of requestSpec.header ? requestSpec.header.split(';') : []) {
      const [name, value] = header.split(':');
      const headers = new Headers(init?.headers);
      expect(headers.get(name)).toBe(value);
    }
    if (requestSpec.body_contains) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      for (const [key, value] of Object.entries(requestSpec.body_contains)) {
        expect(body[key]).toEqual(value);
      }
    }
    const responseSpec = case_.response;
    const headers: Record<string, string> = {};
    if (responseSpec.json !== undefined) {
      headers['content-type'] = 'application/json';
      return new Response(JSON.stringify(responseSpec.json), {
        status: responseSpec.status,
        headers,
      });
    }
    headers['content-type'] = responseSpec.content_type ?? 'text/plain';
    return new Response(responseSpec.text ?? '', { status: responseSpec.status, headers });
  }) as unknown as typeof fetch;
}

function toContractHits(items: WebSearchResultItem[]) {
  return items.map((item) => ({ title: item.title, url: item.url, content: item.snippet }));
}

describe('web-search contract parity (family fixtures)', () => {
  for (const case_ of FIXTURES.cases) {
    it(`fixture ${case_.id}`, async () => {
      const fetchImpl = fetchImplFor(case_);
      const args = {
        config: toDesktopConfig(case_.config),
        query: case_.query,
        maxResults: 5,
        signal: new AbortController().signal,
        key: case_.api_key,
        fetchImpl,
      };
      if ('expected_error_kind' in case_ && case_.expected_error_kind) {
        const fetcher = SEARCH_FETCHERS[toDesktopConfig(case_.config).type];
        if (!fetcher) {
          // the Python core classifies unknown types at normalization; the
          // desktop union cannot express them — the fixture is satisfied by
          // the type never existing here.
          expect(SEARCH_PROVIDER_TYPES).not.toContain(case_.config.type);
          return;
        }
        await expect(fetcher(args)).rejects.toMatchObject({
          kind: case_.expected_error_kind,
        });
        return;
      }
      const fetcher = SEARCH_FETCHERS[toDesktopConfig(case_.config).type];
      expect(fetcher).toBeDefined();
      const items = await fetcher(args);
      expect(toContractHits(items)).toEqual(case_.expected_hits);
    });
  }

  it('the vendored catalog drives the TS provider list (data-once parity)', () => {
    const catalog = JSON.parse(
      readFileSync(join(__dirname, '..', 'contracts', 'search-providers.json'), 'utf-8'),
    ) as {
      providerOrder: string[];
      providers: Record<string, { requiresKey: boolean; label: string }>;
    };
    expect(catalog.providerOrder).toEqual(SEARCH_PROVIDER_TYPES);
    for (const type of SEARCH_PROVIDER_TYPES) {
      expect(catalog.providers[type]).toBeDefined();
      expect(catalog.providers[type].requiresKey).toBe(searchProviderUsesKey(type));
    }
  });
});
