import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const MAX_BYTES = 2_000_000;
const ROBOTS_TIMEOUT_MS = 2_500;

const schema = z.object({
  url: z.string().describe('The http(s) URL to fetch.'),
});

type FetchArgs = z.infer<typeof schema>;

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (host === '[::1]' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

function assertFetchableUrl(raw: string): URL {
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

function parseRobotsForStar(robotsTxt: string, pathname: string): boolean {
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

async function isBlockedByRobots(url: URL): Promise<boolean> {
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

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function readBodyCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

export const webFetchTool: NativeToolDefinition<FetchArgs> = {
  name: 'web_fetch',
  description:
    'Fetch a public http(s) web page and return its readable text. Use for pages the user mentions or that you need to read. Respects robots.txt and refuses private/local addresses.',
  schema,
  risk: 'read-only',
  category: 'network',
  timeoutMs: 20_000,
  summarize: (args) => `Fetched ${args.url}`,
  resultCharCap: 8_000,
  async exec(args, ctx) {
    const url = assertFetchableUrl(args.url);
    if (await isBlockedByRobots(url)) {
      return `Blocked by robots.txt: ${url.origin}/robots.txt disallows this path.`;
    }
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok) {
        return `The page responded with HTTP ${response.status} ${response.statusText}.`;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!/text\/|json|xml|html/i.test(contentType)) {
        return `Unsupported content type "${contentType}" — only text content can be read.`;
      }
      const body = await readBodyCapped(response);
      if (!body.trim()) {
        return 'The page returned no content.';
      }
      const text = /html/i.test(contentType) ? stripHtml(body) : body;
      return `Content of ${url.toString()}:\n\n${text}`;
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  },
};
