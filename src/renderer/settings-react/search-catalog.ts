/**
 * Web-search provider catalog (ADR-0035 / plan 28) — the renderer-side
 * projection of the vendored family contract `contracts/search-providers.json`
 * (canonical: the family dev repo; sync via `scripts/` per its header). The
 * settings UI renders entirely from this data — labels, key requirements,
 * base-URL rules, extra fields, limits. Never hand-edit entries here; edit
 * the contract and re-vendor.
 */
import rawCatalog from '../../../contracts/search-providers.json';
import type { WebSearchProviderCatalog } from '@neuronection/assistant-ui/web-search-providers';

interface RawCatalogField {
  id: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

interface RawCatalogEntry {
  label: string;
  requiresKey: boolean;
  keyUrl: string | null;
  baseUrl: string | null;
  baseUrlRequired: boolean;
  baseUrlHint: string | null;
  notes: string | null;
  fields?: RawCatalogField[];
}

interface RawCatalog {
  providerOrder: string[];
  providers: Record<string, RawCatalogEntry>;
  limits: {
    maxResults: { default: number; min: number; max: number };
    timeoutMs: { default: number; min: number; max: number };
  };
}

const contract = rawCatalog as unknown as RawCatalog;

export const SEARCH_CATALOG: WebSearchProviderCatalog = {
  order: contract.providerOrder,
  entries: contract.providers as unknown as WebSearchProviderCatalog['entries'],
};

export const SEARCH_LIMITS = contract.limits;

/** Desktop-only per-instance tuning fields (config `timeoutMs`/`maxResults`)
 * rendered by the library settings form's Advanced disclosure. */
export const SEARCH_EXTRA_FIELDS = [
  {
    id: 'timeout_ms',
    label: 'Timeout (ms)',
    required: false,
    type: 'number' as const,
    advanced: true,
    placeholder: String(contract.limits.timeoutMs.default),
  },
  {
    id: 'max_results',
    label: 'Default result count',
    required: false,
    type: 'number' as const,
    advanced: true,
    placeholder: String(contract.limits.maxResults.default),
  },
];
