import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import { getMemoryService } from '@main/services/MemoryService';

const schema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Maximum memories to list (default 20).'),
});

export const memoryListTool: NativeToolDefinition<{ limit?: number }> = {
  name: 'memory_list',
  description: 'List stored memories, most recent first. Read-only.',
  schema,
  risk: 'read-only',
  category: 'memory',
  timeoutMs: 5_000,
  resultCharCap: 4_000,
  summarize: () => 'List memories',
  async exec(args) {
    const rows = await getMemoryService().list(args.limit ?? 20);
    if (rows.length === 0) {
      return 'No memories stored yet.';
    }
    return `${rows.length} ${rows.length === 1 ? 'memory' : 'memories'} stored:\n${rows
      .map((row) => `- [${row.id}] ${row.content}`)
      .join('\n')}`;
  },
};
