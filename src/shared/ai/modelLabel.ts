import type { LLMProvider } from '@shared/types';

const LABEL_SEPARATOR = ' · ';

const FALLBACK_HOST = 'local';
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function endpointHost(apiBase: string | undefined): string {
  const raw = (apiBase ?? '').trim();
  if (!raw) {
    return FALLBACK_HOST;
  }
  const candidate = SCHEME_PATTERN.test(raw) ? raw : `http://${raw}`;
  try {
    const host = new URL(candidate).hostname;
    if (host) {
      return host.replace(/^\[|\]$/g, '');
    }
  } catch {
    return raw;
  }
  return raw;
}

export function providerDisplayNames(providers: LLMProvider[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const provider of providers) {
    counts.set(provider.name, (counts.get(provider.name) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const provider of providers) {
    const shared = (counts.get(provider.name) ?? 0) > 1;
    names.set(provider.id, shared ? `${provider.name} (${endpointHost(provider.apiBase)})` : provider.name);
  }
  return names;
}

export function formatModelLabel(providerName: string, modelName: string): string {
  return `${providerName}${LABEL_SEPARATOR}${modelName}`;
}
