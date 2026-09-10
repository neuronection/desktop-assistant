import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const schema = z.object({
  text: z.string().describe('The text to place on the clipboard.'),
});

export const clipboardWriteTool: NativeToolDefinition<{ text: string }> = {
  name: 'clipboard_write',
  description: 'Write text to the system clipboard, replacing its current content.',
  schema,
  risk: 'state-changing',
  category: 'desktop',
  resultCharCap: 500,
  timeoutMs: 5_000,
  summarize: (args) => `Copy ${args.text.length} chars to clipboard`,
  async exec(args) {
    const { clipboard } = await import('electron');
    await clipboard.writeText(args.text);
    return `Copied ${args.text.length} characters to the clipboard.`;
  },
};
