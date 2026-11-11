import { classifyHost, egressAllowed, type EgressEntry, type EgressMode } from '@shared/egress';
import { currentTurnContext } from '@main/ai/turn-context';

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

export function createGuardedFetch(original: typeof fetch, getMode: () => EgressMode): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    let host = '';
    let classification: ReturnType<typeof classifyHost> = 'public';
    try {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (/^https?:/i.test(raw)) {
        const url = new URL(raw);
        host = url.hostname.replace(/^\[|\]$/g, '');
        classification = classifyHost(host);
      }
    } catch {
      return original(input, init);
    }
    if (!host) {
      return original(input, init);
    }
    const mode = getMode();
    const allowed = egressAllowed(mode, classification);
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
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
    return original(input, init);
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
