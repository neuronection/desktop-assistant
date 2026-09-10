import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { getMemoryService } from '@main/services/MemoryService';

const schema = z.object({
  content: z
    .string()
    .min(1)
    .max(2_000)
    .describe('The memory to keep, as one self-contained sentence (e.g. "My deploy user is admin").'),
  tags: z.array(z.string()).optional().describe('Optional short labels, e.g. ["work"].'),
});

export const memorySaveTool: NativeToolDefinition<{ content: string; tags?: string[] }> = {
  name: 'memory_save',
  description:
    'Persist a fact for future conversations. Use when the user asks to remember something, or offers a durable preference worth keeping. Near-identical memories are merged automatically.',
  schema,
  risk: 'state-changing',
  category: 'memory',
  timeoutMs: 5_000,
  summarize: (args) => `Remember: ${args.content.slice(0, 80)}`,
  async exec(args) {
    const { merged } = await getMemoryService().save({ content: args.content, source: 'assistant', tags: args.tags });
    return merged ? 'Merged with an existing memory.' : 'Remembered.';
  },
};
