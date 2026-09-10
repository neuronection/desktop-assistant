import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const schema = z.object({});

export const clipboardReadTool: NativeToolDefinition<Record<string, never>> = {
  name: 'clipboard_read',
  description: 'Read the current text content of the clipboard, if any.',
  schema,
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: 5_000,
  summarize: () => 'Read the clipboard',
  async exec() {
    const { clipboard } = await import('electron');
    const text = await clipboard.readText();
    if (!text) {
      return 'The clipboard is empty or contains no text.';
    }
    return `Clipboard (${text.length} chars):\n${text}`;
  },
};
