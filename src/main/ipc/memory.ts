import { ipcMain } from 'electron';
import type { MemoryRestoreInput, MemoryView } from '@shared/memory';
import { getMemoryService } from '@main/services/MemoryService';
import type { MemoryConsolidationService } from '@main/services/MemoryConsolidationService';

/** Every channel this module registers (the teardown list consumes this). */
export const MEMORY_IPC_CHANNELS: string[] = [
  'memory:list', 'memory:search', 'memory:delete', 'memory:restore', 'memory:consolidate',
];

export interface MemoryIpcDeps {
  consolidation: MemoryConsolidationService;
}

const toMemoryView = (row: {
  id: string;
  content: string;
  source: string;
  tags: unknown;
  conversationId: string | null;
  mergedFrom?: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MemoryView => ({
  id: row.id,
  content: row.content,
  source: row.source === 'assistant' ? 'assistant' : 'user',
  tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  conversationId: row.conversationId,
  mergedFrom: Array.isArray(row.mergedFrom)
    ? (row.mergedFrom.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { id?: unknown }).id === 'string' &&
          typeof (entry as { content?: unknown }).content === 'string' &&
          typeof (entry as { mergedAt?: unknown }).mergedAt === 'string'
      ) as MemoryView['mergedFrom'])
    : undefined,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export function registerMemoryIpc(deps: MemoryIpcDeps): void {
  const { consolidation } = deps;

  ipcMain.handle('memory:list', async (_event, limit?: number, offset?: number): Promise<MemoryView[]> => {
    const rows = await getMemoryService().list(limit, offset);
    return rows.map(toMemoryView);
  });

  ipcMain.handle('memory:search', async (_event, query: string, limit?: number): Promise<MemoryView[]> => {
    const rows = await getMemoryService().search(query, limit);
    return rows.map(toMemoryView);
  });

  ipcMain.handle('memory:delete', async (_event, id: string): Promise<boolean> => {
    return getMemoryService().forgetById(id);
  });

  ipcMain.handle('memory:restore', async (_event, input: MemoryRestoreInput): Promise<MemoryView> => {
    const { memory } = await getMemoryService().save({
      content: input.content,
      source: input.source,
      conversationId: input.conversationId ?? null,
      tags: input.tags,
    });
    return toMemoryView(memory);
  });

  ipcMain.handle('memory:consolidate', async () => {
    const rows = await getMemoryService().list(500, 0);
    return consolidation.consolidatePass(
      rows.map((row) => ({ id: row.id, content: row.content, source: row.source === 'assistant' ? ('assistant' as const) : ('user' as const) })),
      (targetId, mergedContent, absorbed) =>
        getMemoryService()
          .mergeIntoAndRemoveSource(targetId, mergedContent, absorbed)
          .then(() => undefined)
    );
  });
}
