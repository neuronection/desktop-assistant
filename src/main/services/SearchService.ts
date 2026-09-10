import { MainConfigService } from './ConfigService';
import { SecretService } from './SecretService';
import type {
  SearchProviderConfig,
  SearchProviderSaveInput,
  SearchProviderTestResult,
  SearchProviderView,
  WebSearchOutcome,
} from '@shared/search';
import { SEARCH_FETCHERS, assertHttpUrl, clampResultCount, type FetchImpl } from './search-providers';

export const SEARCH_DEFAULT_TIMEOUT_MS = 8_000;
export const SEARCH_MAX_TIMEOUT_MS = 30_000;

export function searchProviderSecretKey(providerId: string): string {
  return `search:${providerId}:key`;
}

function effectiveTimeout(config: SearchProviderConfig): number {
  const n = Math.round(config.timeoutMs ?? SEARCH_DEFAULT_TIMEOUT_MS);
  return Math.min(SEARCH_MAX_TIMEOUT_MS, Math.max(1_000, Number.isFinite(n) ? n : SEARCH_DEFAULT_TIMEOUT_MS));
}

/**
 * Owns the ordered web-search provider instances: config CRUD with keys
 * stripped to the keyring (masked pattern), and `search` — instances are
 * queried in array order until one returns results (failover), each with
 * its own timeout. Search results are untrusted observations.
 */
export class SearchService {
  private static instance: SearchService;

  static getInstance(): SearchService {
    if (!SearchService.instance) {
      SearchService.instance = new SearchService();
    }
    return SearchService.instance;
  }

  private constructor() {}

  private config(): SearchProviderConfig[] {
    return MainConfigService.getInstance().getConfig().search?.providers ?? [];
  }

  private async persist(providers: SearchProviderConfig[]): Promise<void> {
    await MainConfigService.getInstance().updateConfig({ search: { providers } });
  }

  private view(config: SearchProviderConfig): SearchProviderView {
    return { config, hasKey: Boolean(config.keyHint) };
  }

  listProviders(): SearchProviderView[] {
    return this.config().map((config) => this.view(config));
  }

  async saveProvider(input: SearchProviderSaveInput): Promise<SearchProviderView> {
    const { key, ...config } = input;
    if (config.type === 'searxng') {
      if (!config.baseUrl) {
        throw new Error('SearXNG needs a base URL.');
      }
      assertHttpUrl(config.baseUrl, 'Base URL');
    }
    if (key !== undefined) {
      const secretService = SecretService.getInstance();
      if (key.trim() === '') {
        await secretService.deleteSecret(searchProviderSecretKey(config.id));
        config.keyHint = undefined;
      } else {
        await secretService.setSecret(searchProviderSecretKey(config.id), key.trim());
        config.keyHint = SecretService.keyHint(key.trim());
      }
    }
    const providers = this.config().filter((provider) => provider.id !== config.id);
    providers.push(config);
    await this.persist(providers);
    return this.view(config);
  }

  async deleteProvider(providerId: string): Promise<boolean> {
    const providers = this.config();
    if (!providers.some((provider) => provider.id === providerId)) {
      return false;
    }
    await this.persist(providers.filter((provider) => provider.id !== providerId));
    await SecretService.getInstance().deleteSecret(searchProviderSecretKey(providerId));
    return true;
  }

  async setProviderEnabled(providerId: string, enabled: boolean): Promise<boolean> {
    const providers = this.config().map((provider) => (provider.id === providerId ? { ...provider, enabled } : provider));
    await this.persist(providers);
    return true;
  }

  async moveProvider(providerId: string, direction: 'up' | 'down'): Promise<boolean> {
    const providers = [...this.config()];
    const index = providers.findIndex((provider) => provider.id === providerId);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= providers.length) {
      return false;
    }
    [providers[index], providers[target]] = [providers[target], providers[index]];
    await this.persist(providers);
    return true;
  }

  async testProvider(providerId: string, fetchImpl?: FetchImpl): Promise<SearchProviderTestResult> {
    const provider = this.config().find((candidate) => candidate.id === providerId);
    if (!provider) {
      return { ok: false, error: 'Unknown search provider.' };
    }
    const startedAt = Date.now();
    const outcome = await this.searchWith('provider smoke test', [provider], 1, fetchImpl);
    const latencyMs = Date.now() - startedAt;
    if (outcome.ok) {
      return { ok: true, latencyMs, resultCount: outcome.items.length };
    }
    return { ok: false, latencyMs, error: outcome.errors?.[0] ?? 'Search failed.' };
  }

  /** Ordered failover across every enabled instance. */
  async search(query: string, maxResults?: number, fetchImpl?: FetchImpl): Promise<WebSearchOutcome> {
    const enabled = this.config().filter((provider) => provider.enabled);
    if (enabled.length === 0) {
      return {
        ok: false,
        items: [],
        errors: ['No web-search providers are configured. Add one in Settings → Tools → Web search.'],
      };
    }
    return this.searchWith(query, enabled, maxResults, fetchImpl);
  }

  private async searchWith(
    query: string,
    providers: SearchProviderConfig[],
    maxResults: number | undefined,
    fetchImpl?: FetchImpl
  ): Promise<WebSearchOutcome> {
    const errors: string[] = [];
    for (const provider of providers) {
      const fetcher = SEARCH_FETCHERS[provider.type];
      if (!fetcher) {
        errors.push(`${provider.name}: unknown provider type '${provider.type}'.`);
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), effectiveTimeout(provider));
      try {
        const key = provider.keyHint
          ? ((await SecretService.getInstance().getSecret(searchProviderSecretKey(provider.id))) ?? null)
          : null;
        const items = await fetcher({
          config: provider,
          key,
          query,
          maxResults: clampResultCount(maxResults ?? provider.maxResults),
          signal: controller.signal,
          ...(fetchImpl ? { fetchImpl } : {}),
        });
        if (items.length > 0) {
          return { ok: true, items, provider: provider.name, errors };
        }
        errors.push(`${provider.name}: no results.`);
      } catch (error) {
        const message = (error as Error).name === 'AbortError'
          ? `${provider.name}: timed out after ${Math.round(effectiveTimeout(provider) / 1000)}s.`
          : `${provider.name}: ${((error as Error).message ?? String(error)).slice(0, 200)}`;
        errors.push(message);
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, items: [], errors };
  }
}
