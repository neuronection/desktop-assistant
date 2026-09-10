/** Web-search provider settings (instances live in `config.search.providers`). */

export type SearchProviderType = 'searxng' | 'brave' | 'tavily' | 'exa' | 'serper' | 'google-pse';

export const SEARCH_PROVIDER_TYPES: SearchProviderType[] = ['searxng', 'brave', 'tavily', 'exa', 'serper', 'google-pse'];

/** True when the provider authenticates with a keyring secret. */
export function searchProviderUsesKey(type: SearchProviderType): boolean {
  return type !== 'searxng';
}

/** Non-secret settings; API keys live only in the OS keyring. */
export interface SearchProviderConfig {
  id: string;
  name: string;
  type: SearchProviderType;
  enabled: boolean;
  /** Service URL — required for searxng, optional endpoint override for others. */
  baseUrl?: string;
  /** google-pse only: the programmable-search engine id (not secret). */
  googleCx?: string;
  /** Masked key hint (SecretService.keyHint); presence means a key is stored. */
  keyHint?: string;
  /** Per-instance call timeout (default 8000). */
  timeoutMs?: number;
  /** Default result count for this instance (default 5, clamp 1–10). */
  maxResults?: number;
}

/** Wire shape for the settings UI — never carries key material. */
export interface SearchProviderView {
  config: SearchProviderConfig;
  hasKey: boolean;
}

/** Renderer → main save payload; the only path key material may travel. */
export interface SearchProviderSaveInput extends SearchProviderConfig {
  /** undefined keeps the stored key, '' clears it, a value replaces it. */
  key?: string;
}

export interface SearchProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  resultCount?: number;
  error?: string;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  ok: boolean;
  items: WebSearchResultItem[];
  /** Name of the instance that served the results. */
  provider?: string;
  /** Per-instance failures from tried providers, in order. */
  errors?: string[];
}
