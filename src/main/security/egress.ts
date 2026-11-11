import { classifyHost, egressAllowed, type EgressEntry, type EgressMode } from '@shared/egress';
import { currentTurnContext } from '@main/ai/turn-context';
import { currentEgressPurpose } from './egress-purpose';

const MAX_ENTRIES = 200;
const entries: EgressEntry[] = [];
let sequence = 0;
let installed = false;

export class EgressBlockedError extends Error {
  constructor(readonly host: string, readonly mode: EgressMode) {
    super(`Network access to ${host} is blocked by the ${mode} egress policy.`);
    this.name = 'EgressBlockedError';
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function absoluteUrl(input: Parameters<typeof fetch>[0]): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return /^https?:/i.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function createGuardedFetch(original: typeof fetch, getMode: () => EgressMode): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const mode = getMode();
    const initialMethod =
      init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
    const first = absoluteUrl(input);
    if (!first) {
      return original(input, init);
    }

    const record = (url: string, method: string): void => {
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
      const classification = classifyHost(host);
      const allowed = egressAllowed(mode, classification, currentEgressPurpose());
      const turnId = currentTurnContext()?.messageId;
      entries.push({
        id: `egress_${Date.now()}_${sequence++}`,
        at: new Date().toISOString(),
        host,
        classification,
        mode,
        allowed,
        method,
        ...(turnId ? { turnId } : {}),
      });
      if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES);
      }
      if (!allowed) {
        throw new EgressBlockedError(host, mode);
      }
    };

    record(first, initialMethod);
    let response = await original(input, mode === 'off' ? init : { ...init, redirect: 'manual' });
    if (mode === 'off') {
      return response;
    }

    let currentUrl = first;
    let hops = 0;
    while (REDIRECT_STATUS.has(response.status)) {
      hops += 1;
      const location = response.headers.get('location');
      if (!location || hops > 5) {
        throw new EgressBlockedError(new URL(currentUrl).hostname, mode);
      }
      const next = new URL(location, currentUrl);
      const preserve = response.status === 307 || response.status === 308;
      const method = preserve ? initialMethod : 'GET';
      const body =
        method === 'GET'
          ? undefined
          : typeof init?.body === 'string'
            ? init.body
            : init?.body instanceof URLSearchParams
              ? init.body.toString()
              : undefined;
      if (method !== 'GET' && body === undefined) {
        throw new EgressBlockedError(next.hostname, mode);
      }
      record(next.toString(), method);
      response = await original(next.toString(), {
        method,
        headers: init?.headers,
        ...(body !== undefined ? { body } : {}),
        redirect: 'manual',
      });
      currentUrl = next.toString();
    }
    return response;
  }) as typeof fetch;
}

export function installEgressGuard(getMode: () => EgressMode): void {
  if (installed) {
    return;
  }
  installed = true;
  globalThis.fetch = createGuardedFetch(globalThis.fetch.bind(globalThis), getMode);
}

export function getEgressLog(limit = 100): EgressEntry[] {
  return entries.slice(Math.max(0, entries.length - limit)).reverse();
}

export function clearEgressLog(): void {
  entries.length = 0;
}
