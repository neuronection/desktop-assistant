import { PrismaClient, Memory as PrismaMemory } from 'generated/client';

export type MemorySource = 'user' | 'assistant';

export interface MemorySaveInput {
  content: string;
  source: MemorySource;
  conversationId?: string | null;
  tags?: string[];
}

export interface MemorySaveResult {
  memory: PrismaMemory;
  /** True when a near-identical memory existed and was merged into. */
  merged: boolean;
}

/** Dedupe fires at or above this Jaccard similarity (char trigrams). */
export const MEMORY_DEDUPE_SIMILARITY = 0.82;
/** Hard cap on a single memory's content. */
export const MEMORY_CONTENT_MAX = 2_000;
/** Default cap for list/search result counts. */
export const MEMORY_RESULT_CAP = 50;
/** Recall injection: max memories and total characters per turn. */
export const MEMORY_RECALL_LIMIT = 3;
export const MEMORY_RECALL_CHAR_CAP = 600;
/** Dedupe scans the most recent rows only — the table is small and local. */
const DEDUPE_SCAN = 500;

export function normalizeMemoryContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function charTrigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i + 2 < padded.length; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Jaccard similarity over char trigrams (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  const left = charTrigrams(a);
  const right = charTrigrams(b);
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

function termOccurrences(haystack: string, term: string): number {
  if (!term) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(term, index + term.length);
  }
  return count;
}

export interface RankedMemory<T> {
  row: T;
  score: number;
}

/**
 * Deterministic keyword ranking: exact normalized match first, then by
 * total occurrence count of the query terms, newest-first as tiebreak.
 */
export function rankMemories<T extends { content: string }>(rows: T[], query: string): RankedMemory<T>[] {
  const normalizedQuery = normalizeMemoryContent(query);
  const terms = normalizedQuery.split(' ').filter((term) => term.length > 0);
  return rows
    .map((row) => {
      const normalized = normalizeMemoryContent(row.content);
      let score = 0;
      if (normalizedQuery && normalized === normalizedQuery) {
        score += 1_000;
      }
      for (const term of terms) {
        score += termOccurrences(normalized, term);
      }
      return { row, score };
    })
    .sort((left, right) => right.score - left.score);
}

export class MemoryService {
  private db: PrismaClient;

  constructor(getClient: () => PrismaClient) {
    this.db = getClient();
  }

  async save(input: MemorySaveInput): Promise<MemorySaveResult> {
    const content = input.content.trim().slice(0, MEMORY_CONTENT_MAX);
    if (!content) {
      throw new Error('Memory content is empty.');
    }
    const normalized = normalizeMemoryContent(content);
    const existing = await this.db.memory.findMany({
      take: DEDUPE_SCAN,
      orderBy: { updatedAt: 'desc' },
    });
    const dupe =
      existing.find((row) => normalizeMemoryContent(row.content) === normalized) ??
      existing.find(
        (row) => trigramSimilarity(normalizeMemoryContent(row.content), normalized) >= MEMORY_DEDUPE_SIMILARITY
      );
    if (dupe) {
      const mergedTags = new Set([...readTags(dupe), ...(input.tags ?? [])]);
      const memory = await this.db.memory.update({
        where: { id: dupe.id },
        data: {
          content,
          source: input.source,
          conversationId: input.conversationId ?? null,
          tags: mergedTags.size > 0 ? [...mergedTags] : undefined,
        },
      });
      return { memory, merged: true };
    }
    const memory = await this.db.memory.create({
      data: {
        content,
        source: input.source,
        conversationId: input.conversationId ?? null,
        tags: input.tags && input.tags.length > 0 ? [...new Set(input.tags)] : undefined,
      },
    });
    return { memory, merged: false };
  }

  /** Keyword search ranked by `rankMemories`; empty query → most recent. */
  async search(query: string, limit: number = MEMORY_RESULT_CAP): Promise<PrismaMemory[]> {
    const terms = normalizeMemoryContent(query).split(' ').filter((term) => term.length > 0);
    const rows =
      terms.length > 0
        ? await this.db.memory.findMany({
            where: { OR: terms.map((term) => ({ content: { contains: term } })) },
            take: DEDUPE_SCAN,
            orderBy: { updatedAt: 'desc' },
          })
        : await this.db.memory.findMany({ take: limit, orderBy: { updatedAt: 'desc' } });
    if (terms.length === 0) {
      return rows;
    }
    return rankMemories(rows, query)
      .filter((ranked) => ranked.score > 0)
      .slice(0, limit)
      .map((ranked) => ranked.row);
  }

  async list(limit: number = MEMORY_RESULT_CAP, offset = 0): Promise<PrismaMemory[]> {
    return this.db.memory.findMany({
      take: limit,
      skip: offset,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async count(): Promise<number> {
    return this.db.memory.count();
  }

  /** Deletes by id. No wildcards; returns true when a row was removed. */
  async forgetById(id: string): Promise<boolean> {
    const removed = await this.db.memory.deleteMany({ where: { id } });
    return removed.count > 0;
  }

  /** Deletes by exact content match only — never a pattern/wildcard. */
  async forgetByContent(content: string): Promise<boolean> {
    const trimmed = content.trim();
    if (!trimmed) {
      return false;
    }
    const removed = await this.db.memory.deleteMany({ where: { content: trimmed } });
    if (removed.count > 0) {
      return true;
    }
    const normalized = normalizeMemoryContent(trimmed);
    const candidates = await this.db.memory.findMany({ take: DEDUPE_SCAN, orderBy: { updatedAt: 'desc' } });
    const matches = candidates
      .filter((row) => normalizeMemoryContent(row.content) === normalized)
      .map((row) => row.id);
    if (matches.length === 0) {
      return false;
    }
    const result = await this.db.memory.deleteMany({ where: { id: { in: matches } } });
    return result.count > 0;
  }

  /**
   * Chat-turn recall: top keyword-matched memories, greedy-filled up to
   * `limit` rows and `charCap` total characters. Returns contents only.
   */
  async recall(
    query: string,
    limit: number = MEMORY_RECALL_LIMIT,
    charCap: number = MEMORY_RECALL_CHAR_CAP
  ): Promise<string[]> {
    const ranked = await this.search(query, limit * 4);
    const picked: string[] = [];
    let used = 0;
    for (const row of ranked) {
      if (picked.length >= limit || used + row.content.length > charCap) {
        break;
      }
      picked.push(row.content);
      used += row.content.length;
    }
    return picked;
  }
}

function readTags(row: PrismaMemory): string[] {
  if (!Array.isArray(row.tags)) {
    return [];
  }
  return row.tags.filter((tag): tag is string => typeof tag === 'string');
}

let clientProvider: (() => PrismaClient) | null = null;
let shared: MemoryService | null = null;

/** Wired once at boot (DatabaseService.initialize), mirroring the AI audit provider. */
export function setMemoryClientProvider(provider: (() => PrismaClient) | null): void {
  clientProvider = provider;
  shared = null;
}

/** Shared instance for tool/IPC call sites; throws before boot wiring. */
export function getMemoryService(): MemoryService {
  if (!shared) {
    if (!clientProvider) {
      throw new Error('Memory client provider is not configured yet.');
    }
    shared = new MemoryService(clientProvider);
  }
  return shared;
}
