import { isIP } from 'net';
import { lookup } from 'dns/promises';
import type { LookupAddress } from 'dns';

const ROBOTS_TIMEOUT_MS = 2_500;
export const MAX_REDIRECT_HOPS = 5;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(bytes: Uint8Array): boolean {
  if (bytes.length !== 16) return true;
  const firstSixZero = bytes.slice(0, 6).every((byte) => byte === 0);
  if (firstSixZero) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;
  return false;
}

function ipv6ToBytes(hostname: string): Uint8Array | null {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 6) {
    return null;
  }
  const expandDotted = (groups: string[]): string[] | null => {
    const out: string[] = [];
    for (const part of groups) {
      const dotted = part.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
      if (dotted) {
        const [a, b, c, d] = dotted.slice(1).map(Number);
        if ([a, b, c, d].some((n) => n > 255)) {
          return null;
        }
        out.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
        continue;
      }
      out.push(part);
    }
    return out;
  };
  const doubled = bare.split('::');
  if (doubled.length > 2) {
    return null;
  }
  const head = expandDotted(doubled[0] ? doubled[0].split(':') : []);
  const tail = expandDotted(doubled.length === 2 && doubled[1] ? doubled[1].split(':') : []);
  if (!head || !tail) {
    return null;
  }
  const fill = 8 - head.length - tail.length;
  if (doubled.length === 1 ? fill !== 0 : fill < 1) {
    return null;
  }
  const groups = [...head, ...Array.from({ length: Math.max(0, fill) }, () => '0'), ...tail];
  if (groups.length !== 8) {
    return null;
  }
  const bytes = new Uint8Array(16);
  for (const [index, part] of groups.entries()) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      return null;
    }
    const value = parseInt(part, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return isPrivateIpv4(Number(ipv4[1]), Number(ipv4[2]));
  }
  const v6 = ipv6ToBytes(host);
  if (v6) {
    return isPrivateIpv6(v6);
  }
  return false;
}

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Refusing to fetch private/local network addresses.');
  }
  return url;
}

/**
 * SSRF pre-request rule: resolves every DNS address for the hostname and
 * refuses when any of them is private/loopback/link-local. DNS rebinding
 * between check and connect is out of scope for v1 (single resolver call
 * immediately before the request).
 */
export async function assertPublicResolvedUrl(raw: string): Promise<URL> {
  const url = assertFetchableUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    return url;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${host}`);
  }
  for (const address of addresses) {
    if (address.family === 4) {
      const [a, b] = address.address.split('.').map(Number);
      if (isPrivateIpv4(a, b)) {
        throw new Error('Refusing to fetch private/local network addresses.');
      }
    } else {
      const v6 = ipv6ToBytes(address.address);
      if (v6 && isPrivateIpv6(v6)) {
        throw new Error('Refusing to fetch private/local network addresses.');
      }
    }
  }
  return url;
}

/** Resolves one redirect hop; returns null when the response is final. */
export function redirectTarget(response: Response, previous: URL): URL | null {
  if (response.status < 300 || response.status >= 400) {
    return null;
  }
  const location = response.headers.get('location');
  if (!location) {
    return null;
  }
  return new URL(location, previous);
}

export async function followPublicRedirects(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ response: Response; url: URL }> {
  let current = await assertPublicResolvedUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetchImpl(current, { redirect: 'manual' });
    const next = redirectTarget(response, current);
    if (!next) {
      return { response, url: current };
    }
    if (hop === MAX_REDIRECT_HOPS) {
      throw new Error(`Too many redirects (more than ${MAX_REDIRECT_HOPS}).`);
    }
    current = await assertPublicResolvedUrl(next.toString());
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECT_HOPS}).`);
}

export function parseRobotsForStar(robotsTxt: string, pathname: string): boolean {
  let applies = false;
  for (const rawLine of robotsTxt.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    const [rawKey, ...rest] = line.split(':');
    if (rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*';
    } else if (applies && key === 'disallow' && value.length > 0) {
      if (pathname.startsWith(value)) {
        return true;
      }
    }
  }
  return false;
}

export async function isBlockedByRobots(url: URL): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    const robotsUrl = new URL(url.toString());
    robotsUrl.pathname = '/robots.txt';
    robotsUrl.search = '';
    robotsUrl.hash = '';
    const response = await fetch(robotsUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return false;
    }
    return parseRobotsForStar(await response.text(), url.pathname);
  } catch {
    return false;
  }
}
