import { readFile, stat } from 'fs/promises';
import type { PrismaClient } from 'generated/client';
import { newBudget, walkRoot, type ScanBudget } from '@main/ai/tools/native/file-search';
import { buildFtsQuery } from '@main/services/fts';
import type { DocsSearchHit } from '@shared/docs';

export { buildFtsQuery };
export type { DocsSearchHit };

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
const MAX_FILE_BYTES = 2_000_000;
const SEARCH_RESULT_CAP = 6;
const SNIPPET_CHARS = 220;

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const INDEXABLE_EXTENSIONS = new Set([...TEXT_EXTENSIONS, '.pdf']);

export interface DocsRootStatus {
  root: string;
  files: number;
  chunks: number;
}

export interface IndexSummary {
  files: number;
  chunks: number;
  removed: number;
  truncated: boolean;
}

let clientProvider: (() => PrismaClient) | null = null;
let shared: DocsIndexService | null = null;

export function setDocsIndexClientProvider(provider: (() => PrismaClient) | null): void {
  clientProvider = provider;
  shared = null;
}

export function getDocsIndexService(): DocsIndexService {
  if (!clientProvider) {
    throw new Error('DocsIndexService client provider is not wired.');
  }
  if (!shared) {
    shared = new DocsIndexService(clientProvider);
  }
  return shared;
}

/**
 * Local-docs FTS index (plan 12 §5): granted folders' text files
 * chunked into `DocChunk` rows and mirrored into an external-content
 * FTS5 table via triggers. Opt-in per granted root; re-indexing is an
 * mtime delta. Embeddings stay deferred (D2) — FTS is the store.
 */
export class DocsIndexService {
  private setupPromise: Promise<void> | null = null;

  constructor(private readonly clientProvider: () => PrismaClient) {}

  private client(): PrismaClient {
    return this.clientProvider();
  }

  /** Idempotent FTS bootstrap (checkpointer precedent): virtual table + sync triggers. */
  async setup(): Promise<void> {
    if (!this.setupPromise) {
      this.setupPromise = (async () => {
        await this.client().$executeRawUnsafe(
          `CREATE VIRTUAL TABLE IF NOT EXISTS "DocChunk_fts" USING fts5(text, content='DocChunk', content_rowid='rowid', tokenize='porter unicode61');`
        );
        await this.client().$executeRawUnsafe(
          `CREATE TRIGGER IF NOT EXISTS "DocChunk_fts_insert" AFTER INSERT ON "DocChunk" BEGIN
            INSERT INTO "DocChunk_fts"(rowid, text) VALUES (new.rowid, new.text);
          END;`
        );
        await this.client().$executeRawUnsafe(
          `CREATE TRIGGER IF NOT EXISTS "DocChunk_fts_delete" AFTER DELETE ON "DocChunk" BEGIN
            INSERT INTO "DocChunk_fts"("DocChunk_fts", rowid, text) VALUES ('delete', old.rowid, old.text);
          END;`
        );
        await this.client().$executeRawUnsafe(
          `CREATE TRIGGER IF NOT EXISTS "DocChunk_fts_update" AFTER UPDATE ON "DocChunk" BEGIN
            INSERT INTO "DocChunk_fts"("DocChunk_fts", rowid, text) VALUES ('delete', old.rowid, old.text);
            INSERT INTO "DocChunk_fts"(rowid, text) VALUES (new.rowid, new.text);
          END;`
        );
      })().catch((error) => {
        this.setupPromise = null;
        throw error;
      });
    }
    return this.setupPromise;
  }

  async indexedRoots(): Promise<string[]> {
    const rows = await this.client().docChunk.findMany({ where: {}, select: { root: true }, distinct: ['root'] });
    return rows.map((row) => row.root).sort();
  }

  async status(): Promise<DocsRootStatus[]> {
    await this.setup();
    const rows = await this.client().docChunk.groupBy({ by: ['root'], _count: { _all: true }, _max: { mtimeMs: true } });
    const fileCounts = await this.client().docChunk.groupBy({ by: ['root', 'path'], _count: { _all: true } });
    return rows.map((row) => ({
      root: row.root,
      chunks: row._count._all,
      files: new Set(fileCounts.filter((entry) => entry.root === row.root).map((entry) => entry.path)).size,
    }));
  }

  async removeRoot(root: string): Promise<void> {
    await this.setup();
    await this.client().docChunk.deleteMany({ where: { root } });
  }

  /**
   * Walks the root with the file-tools' traversal rules (symlink-skip,
   * junk prune, budgets), chunks every supported file and replaces its
   * chunks. mtime-delta: unchanged files are skipped entirely.
   */
  async indexRoot(root: string, budget: ScanBudget = newBudget()): Promise<IndexSummary> {
    await this.setup();
    const existing = await this.client().docChunk.findMany({
      where: { root },
      select: { path: true, mtimeMs: true },
      distinct: ['path'],
    });
    const known = new Map(existing.map((row) => [row.path, row.mtimeMs]));
    const seen = new Set<string>();
    const summary: IndexSummary = { files: 0, chunks: 0, removed: 0, truncated: false };

    await walkRoot(
      root,
      async (absolute, relativePath) => {
        seen.add(absolute);
        const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
        if (!INDEXABLE_EXTENSIONS.has(extension)) {
          return;
        }
        const info = await stat(absolute).catch(() => null);
        if (!info || info.size > MAX_FILE_BYTES) {
          return;
        }
        if (known.has(absolute) && known.get(absolute) === info.mtimeMs) {
          summary.files += 1;
          return;
        }
        const text = await this.extractText(absolute, extension).catch(() => null);
        if (!text) {
          return;
        }
        await this.client().docChunk.deleteMany({ where: { path: absolute } });
        const chunks = chunkText(text);
        await this.client().docChunk.createMany({
          data: chunks.map((chunk, index) => ({
            root,
            path: absolute,
            mtimeMs: info.mtimeMs,
            chunkIndex: index,
            text: chunk,
          })),
        });
        summary.files += 1;
        summary.chunks += chunks.length;
      },
      budget
    );

    for (const path of known.keys()) {
      if (!seen.has(path)) {
        await this.client().docChunk.deleteMany({ where: { path } });
        summary.removed += 1;
      }
    }
    summary.truncated = budget.truncated;
    return summary;
  }

  async search(query: string, limit = SEARCH_RESULT_CAP): Promise<DocsSearchHit[]> {
    await this.setup();
    const match = buildFtsQuery(query);
    if (!match) {
      return [];
    }
    const rows = (await this.client().$queryRawUnsafe<Array<{ path: string; root: string; chunkIndex: number; excerpt: string; rank: number }>>(
      `SELECT "DocChunk".path AS path, "DocChunk".root AS root, "DocChunk".chunkIndex AS chunkIndex,
              snippet("DocChunk_fts", 0, '', '…', '…', ${SNIPPET_CHARS}) AS excerpt,
              bm25("DocChunk_fts") AS rank
         FROM "DocChunk_fts"
         JOIN "DocChunk" ON "DocChunk".rowid = "DocChunk_fts".rowid
        WHERE "DocChunk_fts" MATCH ?
        ORDER BY rank
        LIMIT ?`,
      match,
      limit
    )) as Array<{ path: string; root: string; chunkIndex: number; excerpt: string; rank: number }>;
    return rows.map((row) => ({ path: row.path, root: row.root, chunkIndex: row.chunkIndex, excerpt: row.excerpt }));
  }

  private async extractText(absolute: string, extension: string): Promise<string | null> {
    if (extension === '.pdf') {
      const buffer = await readFile(absolute);
      const parsed = await import('pdf-parse');
      const data = await parsed.default(buffer);
      return data.text;
    }
    if (!TEXT_EXTENSIONS.has(extension)) {
      return null;
    }
    const text = await readFile(absolute, 'utf-8');
    return text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
  }
}

/**
 * Splits text into overlapping chunks on paragraph boundaries where
 * possible (pure function — unit-tested without a database).
 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return [];
  }
  if (normalized.length <= CHUNK_CHARS) {
    return [normalized];
  }
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= CHUNK_CHARS) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    if (paragraph.length <= CHUNK_CHARS) {
      current = paragraph;
      continue;
    }
    for (let offset = 0; offset < paragraph.length; offset += CHUNK_CHARS - CHUNK_OVERLAP) {
      const piece = paragraph.slice(offset, offset + CHUNK_CHARS);
      if (piece.length < CHUNK_OVERLAP && chunks.length > 0) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n${piece}`;
        current = '';
        break;
      }
      chunks.push(piece);
      if (offset + CHUNK_CHARS >= paragraph.length) {
        current = '';
        break;
      }
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * FTS5 MATCH builder: plain words become AND-ed prefix terms. FTS5
 * syntax characters are dropped so user input can never inject query
 * grammar (NEAR, column filters, quoting tricks).
 */
