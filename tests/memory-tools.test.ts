import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import { memorySaveTool } from '@main/ai/tools/native/memory-save';
import { memorySearchTool } from '@main/ai/tools/native/memory-search';
import { memoryListTool } from '@main/ai/tools/native/memory-list';
import { memoryForgetTool } from '@main/ai/tools/native/memory-forget';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import { setMemoryClientProvider } from '@main/services/MemoryService';
import type { NativeToolDefinition } from '@main/ai/tools/types';

let dataDir: string;
let client: PrismaClient;

afterAll(async () => {
  if (client) {
    await client.$disconnect();
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

const CREATE_MEMORY = `CREATE TABLE IF NOT EXISTS "Memory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "content" TEXT NOT NULL,
  "tags" JSONB,
  "source" TEXT NOT NULL,
  "conversationId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "Memory_updatedAt_idx" ON "Memory"("updatedAt");`;

const byName = (name: string): NativeToolDefinition<never> => {
  const def = NATIVE_TOOL_CATALOG.find((tool) => tool.name === name);
  if (!def) {
    throw new Error(`Tool ${name} missing from catalog`);
  }
  return def as unknown as NativeToolDefinition<never>;
};

describe('memory tools', () => {
  it('registers the four memory tools with the memory category', () => {
    expect(byName('memory_save').risk).toBe('state-changing');
    expect(byName('memory_search').risk).toBe('read-only');
    expect(byName('memory_list').risk).toBe('read-only');
    expect(byName('memory_forget').risk).toBe('state-changing');
    for (const name of ['memory_save', 'memory_search', 'memory_list', 'memory_forget']) {
      expect((byName(name) as unknown as { category: string }).category).toBe('memory');
    }
  });

  it('save/search/list/forget round-trip through the service', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'da-memory-tools-'));
    client = new PrismaClient({ datasources: { db: { url: `file:${join(dataDir, 'mem.db')}` } } });
    await client.$connect();
    for (const statement of CREATE_MEMORY.split(';').filter((part) => part.trim())) {
      await client.$executeRawUnsafe(statement);
    }
    setMemoryClientProvider(() => client);

    expect(await memorySaveTool.exec({ content: 'Deploy user is admin' }, {})).toBe('Remembered.');
    expect(await memorySaveTool.exec({ content: 'Deploy user is admin' }, {})).toBe(
      'Merged with an existing memory.'
    );

    const searched = (await memorySearchTool.exec({ query: 'deploy admin' }, {})) as string;
    expect(searched).toContain('1 memory found');
    expect(searched).toContain('Deploy user is admin');
    expect(await memorySearchTool.exec({ query: 'nothing matches this' }, {})).toBe(
      'No matching memories found.'
    );

    const listed = (await memoryListTool.exec({}, {})) as string;
    expect(listed).toContain('1 memory stored');
    expect(await memoryListTool.exec({ limit: 5 }, {})).toContain('Deploy user is admin');

    const id = searched.match(/\[([^\]]+)\]/)?.[1] ?? '';
    expect(await memoryForgetTool.exec({ id }, {})).toBe('Forgotten.');
    expect(await memoryForgetTool.exec({ content: 'Deploy user is admin' }, {})).toBe(
      'No matching memory found.'
    );
    expect(await memoryForgetTool.exec({ content: 'missing memory' }, {})).toBe('No matching memory found.');
  });

  it('summarizes calls for approval cards', () => {
    expect(memorySaveTool.summarize({ content: 'Deploy user is admin', tags: undefined })).toContain(
      'Deploy user is admin'
    );
    expect(memorySearchTool.summarize({ query: 'deploy' })).toContain('deploy');
    expect(memoryListTool.summarize({})).toContain('memor');
    expect(memoryForgetTool.summarize({ content: 'Deploy user is admin' })).toContain('Deploy user');
  });
});
