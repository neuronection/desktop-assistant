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

export function classifyHost(hostname: string): EgressClass {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host.startsWith('127.')) {
    return 'loopback';
  }
  if (UPDATE_HOSTS.has(host) || host.endsWith('.githubusercontent.com')) {
    return 'update';
  }
  const ipv6 = host.includes(':');
  if (
    host.endsWith('.local') ||
    isIpv4Private(host) ||
    (ipv6 && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) ||
    /^::ffff:(\d{1,3}\.){3}\d{1,3}$/.test(host) && isIpv4Private(host.replace(/^::ffff:/, ''))
  ) {
    return 'local-network';
  }
  return 'public';
}

/** `update` hosts are the one public exemption (version metadata and release assets). */
export function egressAllowed(mode: EgressMode, classification: EgressClass): boolean {
  if (mode === 'off' || classification === 'update') {
    return true;
  }
  if (mode === 'local-network') {
    return classification === 'loopback' || classification === 'local-network';
  }
  return classification === 'loopback';
}
