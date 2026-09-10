import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const schema = z.object({
  url: z.string().describe('The URL to open in the default browser.'),
});

export const openUrlTool: NativeToolDefinition<{ url: string }> = {
  name: 'open_url',
  description: 'Open a URL (http, https, or mailto) in the user\'s default browser.',
  schema,
  risk: 'state-changing',
  category: 'network',
  timeoutMs: 10_000,
  summarize: (args) => `Open ${args.url}`,
  async exec(args) {
    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      return `Error: '${args.url}' is not a valid URL.`;
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return `Error: protocol '${parsed.protocol}' is not allowed (use http, https, or mailto).`;
    }
    const { shell } = await import('electron');
    await shell.openExternal(parsed.toString());
    return `Opened ${parsed.toString()} in the default browser.`;
  },
};
