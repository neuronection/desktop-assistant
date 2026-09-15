import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { assertFetchableUrl, followPublicRedirects, isBlockedByRobots } from '../net-guard';

const MAX_BYTES = 2_000_000;

const schema = z.object({
  url: z.string().describe('The http(s) URL to fetch.'),
});

type FetchArgs = z.infer<typeof schema>;

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
    assertFetchableUrl(args.url);
    const url = new URL(args.url);
    if (await isBlockedByRobots(url)) {
      return `Blocked by robots.txt: ${url.origin}/robots.txt disallows this path.`;
    }
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const { response, url: finalUrl } = await followPublicRedirects(args.url, (target, init) =>
        fetch(target, { ...init, signal: controller.signal })
      );
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
      return `Content of ${finalUrl.toString()}:\n\n${text}`;
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  },
};
