export const EGRESS_MODES = ['off', 'local-network', 'strict-local'] as const;
export type EgressMode = (typeof EGRESS_MODES)[number];

export interface EgressSettings {
  mode: EgressMode;
}

export type EgressClass = 'loopback' | 'local-network' | 'update' | 'public';

export interface EgressEntry {
  id: string;
  at: string;
  host: string;
  classification: EgressClass;
  mode: EgressMode;
  allowed: boolean;
  method: string;
  /** Turn/message id when the request happened inside a turn (receipt correlation). */
  turnId?: string;
}

const UPDATE_HOSTS = new Set([
  'neuronection.com',
  'www.neuronection.com',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
]);

function isIpv4Private(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) {
    return false;
  }
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 127;
}

/** WHATWG normalises `[::ffff:127.0.0.1]` to `::ffff:7f00:1`; decode it back. */
function mappedIpv4(host: string): string | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!match) {
    return null;
  }
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function classifyHost(hostname: string): EgressClass {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return 'loopback';
  }
  if (UPDATE_HOSTS.has(host) || host.endsWith('.githubusercontent.com')) {
    return 'update';
  }
  const mapped = mappedIpv4(host);
  if (isIpv4Private(host) || (mapped !== null && isIpv4Private(mapped))) {
    return host.startsWith('127.') || mapped?.startsWith('127.') ? 'loopback' : 'local-network';
  }
  const ipv6 = host.includes(':');
  if (ipv6 && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) {
    return 'local-network';
  }
  if (host.endsWith('.local')) {
    return 'local-network';
  }
  if (!host.includes('.') && !ipv6) {
    return 'local-network';
  }
  return 'public';
}

/** `update` hosts are the one public exemption (version metadata and release assets). */
export function egressAllowed(mode: EgressMode, classification: EgressClass, purpose?: 'update'): boolean {
  if (mode === 'off') {
    return true;
  }
  if (classification === 'update') {
    return purpose === 'update';
  }
  if (mode === 'local-network') {
    return classification === 'loopback' || classification === 'local-network';
  }
  return classification === 'loopback';
}
