import { describe, it, expect } from 'vitest';
import { reduceRunStats } from '@main/apps/run/stats';
import type { MiniAppRunRow } from '@main/apps/run/store';

const NOW = 1_700_000_000_000;

function run(overrides: Partial<MiniAppRunRow> = {}): MiniAppRunRow {
  return {
    id: 'run-1',
    packId: 'file-deletion-review',
    packVersion: '0.1.0',
    rootPath: '/home/tester/demo',
    configHash: 'h',
    engineId: 'llm',
    status: 'done',
    totals: { scanned: 10, keep: 4, ask: 4, candidate: 2, ruleDecided: 6, modelDecided: 4, cacheHits: 2, pending: 0 },
    estimateCalls: 8,
    actualCalls: 3,
    inputTokens: 1200,
    outputTokens: 400,
    error: null,
    conversationId: 'conv-1',
    startedAt: NOW - 5000,
    updatedAt: NOW - 4000,
    finishedAt: NOW - 4000,
    ...overrides,
  };
}

const title = (packId: string): string => (packId === 'file-deletion-review' ? 'Deletion review' : packId);

describe('reduceRunStats (plan 29 S1)', () => {
  it('aggregates per pack: runs, items, calls, tokens, and the cache-hit ratio', () => {
    const stats = reduceRunStats(
      [run(), run({ id: 'run-2', updatedAt: NOW - 1000, actualCalls: 5, inputTokens: 800, outputTokens: 100, totals: { scanned: 6, keep: 2, ask: 3, candidate: 1, ruleDecided: 5, modelDecided: 1, cacheHits: 3, pending: 0 } })],
      null,
      NOW,
      title
    );
    expect(stats.windowDays).toBeNull();
    expect(stats.rows).toHaveLength(1);
    const row = stats.rows[0];
    expect(row.packId).toBe('file-deletion-review');
    expect(row.packTitle).toBe('Deletion review');
    expect(row.runs).toBe(2);
    expect(row.itemsScanned).toBe(16);
    expect(row.modelCalls).toBe(8);
    expect(row.inputTokens).toBe(2000);
    expect(row.outputTokens).toBe(500);
    expect(row.cacheHitRatio).toBeCloseTo(5 / 5);
    expect(row.lastRunAt).toBe(NOW - 1000);
  });

  it('filters by the window on updatedAt', () => {
    const stats = reduceRunStats(
      [run(), run({ id: 'run-old', updatedAt: NOW - 90 * 86_400_000 })],
      30,
      NOW,
      title
    );
    expect(stats.windowDays).toBe(30);
    expect(stats.rows).toHaveLength(1);
    expect(stats.rows[0].runs).toBe(1);
  });

  it('counts paused/canceled/failed statuses separately', () => {
    const stats = reduceRunStats(
      [
        run(),
        run({ id: 'run-p', status: 'paused', updatedAt: NOW - 3000 }),
        run({ id: 'run-c', status: 'canceled', updatedAt: NOW - 2000 }),
        run({ id: 'run-f', status: 'failed', updatedAt: NOW - 1000, error: 'boom' }),
      ],
      null,
      NOW,
      title
    );
    const row = stats.rows[0];
    expect(row.runs).toBe(4);
    expect(row.paused).toBe(1);
    expect(row.canceled).toBe(1);
    expect(row.failed).toBe(1);
  });

  it('returns a null cache ratio when the pack never decided by model', () => {
    const stats = reduceRunStats(
      [run({ totals: { scanned: 5, keep: 5, ask: 0, candidate: 0, ruleDecided: 5, modelDecided: 0, cacheHits: 0, pending: 0 } })],
      7,
      NOW,
      title
    );
    expect(stats.rows[0].cacheHitRatio).toBeNull();
  });

  it('returns empty rows for an empty window and sorts newest pack first', () => {
    expect(reduceRunStats([], 7, NOW, title).rows).toHaveLength(0);
    const stats = reduceRunStats(
      [
        run({ packId: 'older-pack', updatedAt: NOW - 9000 }),
        run({ packId: 'newer-pack', updatedAt: NOW - 1000 }),
      ],
      null,
      NOW,
      title
    );
    expect(stats.rows.map((row) => row.packId)).toEqual(['newer-pack', 'older-pack']);
  });
});
