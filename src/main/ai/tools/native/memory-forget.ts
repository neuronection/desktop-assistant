import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { getMemoryService } from '@main/services/MemoryService';

const schema = z
  .object({
    id: z.string().optional().describe('Memory id as returned by memory_list/memory_search.'),
    content: z.string().optional().describe('Exact memory text to remove (no wildcards).'),
  })
  .refine((args) => (args.id !== undefined) !== (args.content !== undefined), {
    message: 'Provide exactly one of id or content.',
  });

export const memoryForgetTool: NativeToolDefinition<{ id?: string; content?: string }> = {
  name: 'memory_forget',
  description:
    'Delete one stored memory by its id or by its exact content. Use when the user asks to forget something. Every call requires user approval.',
  schema,
  risk: 'state-changing',
  category: 'memory',
  timeoutMs: 5_000,
  summarize: (args) => (args.id ? `Forget memory ${args.id}` : `Forget: ${args.content?.slice(0, 60)}`),
  async exec(args) {
    const forgotten = args.id !== undefined
      ? await getMemoryService().forgetById(args.id)
      : await getMemoryService().forgetByContent(args.content ?? '');
    return forgotten ? 'Forgotten.' : 'No matching memory found.';
  },
};
