import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import {
  MemoryService,
  MEMORY_DEDUPE_SIMILARITY,
  MEMORY_RECALL_CHAR_CAP,
  MEMORY_RECALL_LIMIT,
  charTrigrams,
  normalizeMemoryContent,
  rankMemories,
  trigramSimilarity,
} from '@main/services/MemoryService';


let dataDir: string;
const clients: PrismaClient[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
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

async function makeService(): Promise<{ service: MemoryService; client: PrismaClient }> {
  const dbFile = join(dataDir, `${Math.random().toString(36).slice(2)}.db`);
  const client = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  clients.push(client);
  await client.$connect();
  for (const statement of CREATE_MEMORY.split(';').filter((part) => part.trim())) {
    await client.$executeRawUnsafe(statement);
  }
  const service = new MemoryService(() => client);
  return { service, client };
}

describe('memory text helpers', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeMemoryContent('  Deploy   user\nis ADMIN ')).toBe('deploy user is admin');
  });

  it('trigram similarity is 1 for identical, near 0 for disjoint text', () => {
    expect(trigramSimilarity('abc', 'abc')).toBe(1);
    expect(trigramSimilarity(charTrigrams('abc'), charTrigrams('abc'))).toBe(1);
    expect(trigramSimilarity('deploy user is admin', 'deploy user is admin')).toBe(1);
    expect(trigramSimilarity('aaaa', 'zzzz')).toBeLessThan(0.1);
  });

  it('ranks exact matches above partial term hits', () => {
    const rows = [
      { id: 'a', content: 'The deploy user is admin' },
      { id: 'b', content: 'deploy user is admin' },
      { id: 'c', content: 'Likes coffee' },
    ];
    const ranked = rankMemories(rows, 'deploy user is admin');
    expect(ranked[0].row.id).toBe('b');
    expect(ranked[ranked.length - 1].row.id).toBe('c');
  });
});

describe('MemoryService', () => {
  it('saves, lists and survives a reconnect (restart persistence)', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'da-memory-'));
    const dbFile = join(dataDir, 'mem.db');
    const client = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(client);
    await client.$connect();
    for (const statement of CREATE_MEMORY.split(';').filter((part) => part.trim())) {
      await client.$executeRawUnsafe(statement);
    }
    const service = new MemoryService(() => client);
    const { memory } = await service.save({ content: 'Deploy user is admin', source: 'user' });
    expect(memory.source).toBe('user');
    expect(await service.count()).toBe(1);

    const reopened = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    clients.push(reopened);
    await reopened.$connect();
    const rebooted = new MemoryService(() => reopened);
    expect(await rebooted.count()).toBe(1);
    expect((await rebooted.list())[0].content).toBe('Deploy user is admin');
  });

  it('merges exact duplicates and near-identical content into the existing row', async () => {
    const { service } = await makeService();
    const first = await service.save({ content: 'Deploy user is admin', source: 'user' });
    const exact = await service.save({ content: 'Deploy user is admin', source: 'user' });
    expect(exact.merged).toBe(true);
    expect(exact.memory.id).toBe(first.memory.id);

    const near = await service.save({ content: 'Deploy user  is ADMIN!', source: 'assistant' });
    expect(near.merged).toBe(true);
    expect(near.memory.id).toBe(first.memory.id);
    expect(await service.count()).toBe(1);

    const trigramOnly = await service.save({ content: 'Deploy user is admin.', source: 'user' });
    expect(trigramOnly.merged).toBe(true);
    expect(trigramOnly.memory.id).toBe(first.memory.id);
    expect(await service.count()).toBe(1);

    const different = await service.save({ content: 'Prefers dark mode everywhere', source: 'user' });
    expect(different.merged).toBe(false);
    expect(await service.count()).toBe(2);
  });

  it('unions tags when merging and stores tags on create', async () => {
    const { service } = await makeService();
    await service.save({ content: 'Deploy user is admin', source: 'user', tags: ['work'] });
    const { memory, merged } = await service.save({
      content: 'Deploy user is admin',
      source: 'assistant',
      tags: ['ops'],
    });
    expect(merged).toBe(true);
    expect(memory.tags).toEqual(['work', 'ops']);
  });

  it('search ranks matching memories first and ignores non-matching', async () => {
    const { service } = await makeService();
    await service.save({ content: 'Prefers dark mode everywhere', source: 'user' });
    await service.save({ content: 'Deploy user is admin', source: 'user' });
    await service.save({ content: 'Coffee at 8am daily', source: 'assistant' });

    const hits = await service.search('deploy admin');
    expect(hits).toHaveLength(1);
    expect(hits[0].content).toBe('Deploy user is admin');

    expect(await service.search('')).toHaveLength(3);
    expect(await service.search('zzzq')).toHaveLength(0);
  });

  it('forgets by id and by exact content only — no wildcards', async () => {
    const { service } = await makeService();
    const a = await service.save({ content: 'Deploy user is admin', source: 'user' });
    await service.save({ content: 'Coffee at 8am daily', source: 'user' });

    expect(await service.forgetById('missing')).toBe(false);
    expect(await service.forgetById(a.memory.id)).toBe(true);
    expect(await service.count()).toBe(1);

    expect(await service.forgetByContent('Coffee%')).toBe(false);
    expect(await service.forgetByContent('Coffee at 8am daily')).toBe(true);
    expect(await service.count()).toBe(0);
    expect(await service.forgetByContent('  ')).toBe(false);
  });

  it('forgetByContent matches normalized near-duplicates saved earlier', async () => {
    const { service } = await makeService();
    await service.save({ content: 'Deploy user is admin', source: 'user' });
    expect(await service.forgetByContent('deploy user is admin')).toBe(true);
    expect(await service.count()).toBe(0);
  });

  it('recall returns at most limit memories within the char cap', async () => {
    const { service } = await makeService();
    for (let i = 0; i < 6; i += 1) {
      await service.save({ content: `Project ${i} uses the deploy pipeline`, source: 'user' });
    }
    await service.save({ content: 'Unrelated grocery list', source: 'user' });

    const recalled = await service.recall('deploy pipeline', MEMORY_RECALL_LIMIT, MEMORY_RECALL_CHAR_CAP);
    expect(recalled.length).toBeLessThanOrEqual(MEMORY_RECALL_LIMIT);
    expect(recalled.join(' ').length).toBeLessThanOrEqual(MEMORY_RECALL_CHAR_CAP);
    expect(recalled.length).toBeGreaterThan(0);
  });

  it('rejects empty content', async () => {
    const { service } = await makeService();
    await expect(service.save({ content: '   ', source: 'user' })).rejects.toThrow(/empty/i);
  });

  it('dedupe threshold is conservative (near-identical only)', () => {
    expect(MEMORY_DEDUPE_SIMILARITY).toBeGreaterThanOrEqual(0.8);
    expect(trigramSimilarity('deploy user is admin', 'deploy user is root')).toBeLessThan(
      MEMORY_DEDUPE_SIMILARITY
    );
  });
});
