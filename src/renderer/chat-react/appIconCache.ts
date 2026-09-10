import type { CommandEntry } from '@shared/commands';

/**
 * Lazy app-icon loader (plan 14 §2 payload budget): icon data-URLs
 * never ride the catalog snapshot — they are fetched per visible row
 * through `commands:get-app-icon` and held in a small LRU cache.
 */
const CAP = 256;
const cache = new Map<string, Promise<string | null>>();

function load(key: string): Promise<string | null> {
  const inflight = window.electronAPI.getAppIcon(key);
  cache.set(key, inflight);
  inflight
    .then(() => {
      if (cache.size > CAP) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined && oldest !== key) {
          cache.delete(oldest);
        }
      }
    })
    .catch(() => undefined);
  return inflight;
}

export function getAppIconDataUrl(appId: string): Promise<string | null> {
  const existing = cache.get(appId);
  if (existing) {
    return existing;
  }
  return load(appId);
}

export function invalidateAppIcons(): void {
  cache.clear();
}

/** Deterministic monogram tile: hue from a string hash (plan 14 D7). */
export function monogramStyle(id: string): { backgroundColor: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return { backgroundColor: `hsl(${hue} 42% 30%)` };
}

export function entryAppId(entry: CommandEntry): string | null {
  return entry.icon?.startsWith('app-icon:') ? entry.icon.slice('app-icon:'.length) : null;
}
