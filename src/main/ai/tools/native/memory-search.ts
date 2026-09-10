import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { getMemoryService } from '@main/services/MemoryService';

const schema = z.object({
  query: z.string().min(1).describe('Keywords to look for in stored memories.'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum results (default 8).'),
});

export const memorySearchTool: NativeToolDefinition<{ query: string; limit?: number }> = {
  name: 'memory_search',
  description: 'Search the assistant persistent memory by keywords. Read-only.',
  schema,
  risk: 'read-only',
  category: 'memory',
  timeoutMs: 5_000,
  resultCharCap: 4_000,
  summarize: (args) => `Search memories: ${args.query.slice(0, 60)}`,
  async exec(args) {
    const rows = await getMemoryService().search(args.query, args.limit ?? 8);
    if (rows.length === 0) {
      return 'No matching memories found.';
    }
    return `${rows.length} ${rows.length === 1 ? 'memory' : 'memories'} found:\n${rows
      .map((row) => `- [${row.id}] ${row.content}`)
      .join('\n')}`;
  },
};
