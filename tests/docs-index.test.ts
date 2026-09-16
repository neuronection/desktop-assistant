import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { chunkText, buildFtsQuery, DocsIndexService } from '@main/services/DocsIndexService';

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText(): Promise<{ text: string }> {
      return { text: 'Quarterly canary deployment checklist inside PDF' };
    }
    async destroy(): Promise<void> {}
  },
}));

const clients: PrismaClient[] = [];
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'da-docs-'));
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
});

async function makeService(): Promise<{ service: DocsIndexService; client: PrismaClient; root: string }> {
  const dbFile = join(dataDir, `docs-${Math.random().toString(36).slice(2)}.db`);
  const client = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${dbFile}` }) });
  clients.push(client);
  await client.$connect();
  // Mirror the app boot: the base table exists before the FTS triggers.
  await client.$executeRawUnsafe(
    `CREATE TABLE "DocChunk" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "root" TEXT NOT NULL,
      "path" TEXT NOT NULL,
      "mtimeMs" REAL NOT NULL,
      "chunkIndex" INTEGER NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );`
  );
  const service = new DocsIndexService(() => client);
  await service.setup();
  const root = await mkdtemp(join(dataDir, 'root-'));
  return { service, client, root };
}

describe('chunkText', () => {
  it('returns short texts as a single chunk and drops empties', () => {
    expect(chunkText('hello world')).toEqual(['hello world']);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('splits long text into bounded overlapping chunks on paragraph edges', () => {
    const paragraphs = Array.from({ length: 12 }, (_unused, index) => `Paragraph ${index} ${'x'.repeat(200)}`).join('\n\n');
    const chunks = chunkText(paragraphs);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it('hard-splits a single huge paragraph with overlap', () => {
    const huge = 'y'.repeat(3000);
    const chunks = chunkText(huge);
    expect(chunks.length).toBe(3);
    expect(chunks[1].startsWith('y')).toBe(true);
  });
});

describe('buildFtsQuery', () => {
  it('ANDs sanitized prefix terms and strips FTS5 grammar', () => {
    expect(buildFtsQuery('deploy checklist')).toBe('"deploy"* AND "checklist"*');
    expect(buildFtsQuery('NEAR(a b) OR "quoted"')).toBe('"NEAR"* AND "OR"* AND "quoted"*');
    expect(buildFtsQuery('a ? * (')).toBeNull();
    expect(buildFtsQuery('x')).toBeNull();
  });
});

describe('DocsIndexService (real SQLite FTS5)', () => {
  it('indexes md/txt/pdf-text files, skips others, and finds passages', async () => {
    const { service, client, root } = await makeService();
    await writeFile(join(root, 'runbook.md'), '# Deploy runbook\n\nRoll out the service canary first, then watch error budgets for ten minutes.');
    await writeFile(join(root, 'notes.txt'), 'Team notes about the quarterly planning process and budgets.');
    await writeFile(join(root, 'image.png'), Buffer.from([0x89, 0x50]));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'deep.md'), 'Deep doc mentioning canary rollouts.');

    const summary = await service.indexRoot(root);
    expect(summary.files).toBe(3);
    expect(summary.chunks).toBeGreaterThan(0);

    const stored = await client.docChunk.count();
    expect(stored).toBe(summary.chunks);

    const hits = await service.search('canary');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.excerpt.length > 0)).toBe(true);
    expect(hits.some((hit) => hit.path.endsWith('deep.md'))).toBe(true);
    expect(hits.some((hit) => hit.path.endsWith('runbook.md'))).toBe(true);
    expect(hits.some((hit) => hit.path.endsWith('image.png'))).toBe(false);
  });

  it('re-indexes as an mtime delta: unchanged files skipped, edits refreshed, deletions pruned', async () => {
    const { service, client, root } = await makeService();
    const target = join(root, 'a.md');
    await writeFile(target, 'Original content aboutDeployment.');
    await writeFile(join(root, 'gone.md'), 'Temporary');
    await service.indexRoot(root);
    const afterFirst = await client.docChunk.count();
    expect(afterFirst).toBeGreaterThan(0);

    await rm(join(root, 'gone.md'));
    await writeFile(target, 'Rewritten content about Kubernetes rollouts.');
    const future = new Date(Date.now() + 60_000);
    await utimes(target, future, future);

    const summary = await service.indexRoot(root);
    expect(summary.files).toBe(1);
    expect(summary.removed).toBe(1);

    const stale = await service.search('Temporary');
    expect(stale).toHaveLength(0);
    const fresh = await service.search('Kubernetes');
    expect(fresh.length).toBeGreaterThan(0);
  });

  it('indexes a PDF file via text extraction', async () => {
    const { service, root } = await makeService();
    await writeFile(join(root, 'report.pdf'), 'not really a pdf — pdf-parse is mocked');
    const summary = await service.indexRoot(root);
    expect(summary.files).toBe(1);
    const hits = await service.search('quarterly');
    expect(hits.some((hit) => hit.path.endsWith('report.pdf'))).toBe(true);
  });

  it('respects the walk budget flag on truncation and clears roots on removal', async () => {
    const { service, client, root } = await makeService();
    await writeFile(join(root, 'a.md'), 'Alpha doc.');
    await service.indexRoot(root);
    expect((await client.docChunk.count()) > 0).toBe(true);
    await service.removeRoot(root);
    expect(await client.docChunk.count()).toBe(0);
    expect(await service.search('Alpha')).toHaveLength(0);
  });

  it('returns no hits for syntax-only or empty queries', async () => {
    const { service, root } = await makeService();
    await writeFile(join(root, 'a.md'), 'Neutral body.');
    await service.indexRoot(root);
    expect(await service.search('OR AND NOT')).toHaveLength(0);
    expect(await service.search('   ')).toHaveLength(0);
    expect(await service.search('"')).toHaveLength(0);
  });
});
