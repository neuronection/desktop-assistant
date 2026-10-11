import type { MiniAppRunStats, MiniAppRunStatsRow } from '@shared/app-pack';
import type { MiniAppRunRow } from './store';

const DAY_MS = 86_400_000;

interface Accumulator {
  runs: number;
  itemsScanned: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  modelDecided: number;
  paused: number;
  canceled: number;
  failed: number;
  lastRunAt: number | null;
}

/**
 * Pure reduce over run rows for the Usage dashboard (plan 29 S1): the
 * renderer never scans run rows — main aggregates and returns per-pack
 * rollups. Window filtering rides `updatedAt`; the row set is bounded
 * by run retention (newest 50 finished per pack, paused/interrupted
 * always kept), which the dashboard surfaces honestly.
 */
export function reduceRunStats(
  rows: MiniAppRunRow[],
  windowDays: number | null,
  now: number,
  packTitle: (packId: string) => string
): MiniAppRunStats {
  const since = windowDays !== null ? now - windowDays * DAY_MS : null;
  const byPack = new Map<string, Accumulator>();
  for (const row of rows) {
    if (since !== null && row.updatedAt < since) {
      continue;
    }
    let acc = byPack.get(row.packId);
    if (!acc) {
      acc = {
        runs: 0,
        itemsScanned: 0,
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheHits: 0,
        modelDecided: 0,
        paused: 0,
        canceled: 0,
        failed: 0,
        lastRunAt: null,
      };
      byPack.set(row.packId, acc);
    }
    acc.runs += 1;
    acc.itemsScanned += row.totals?.scanned ?? 0;
    acc.modelCalls += row.actualCalls;
    acc.inputTokens += row.inputTokens;
    acc.outputTokens += row.outputTokens;
    acc.cacheHits += row.totals?.cacheHits ?? 0;
    acc.modelDecided += row.totals?.modelDecided ?? 0;
    if (row.status === 'paused') {
      acc.paused += 1;
    } else if (row.status === 'canceled') {
      acc.canceled += 1;
    } else if (row.status === 'failed') {
      acc.failed += 1;
    }
    if (acc.lastRunAt === null || row.updatedAt > acc.lastRunAt) {
      acc.lastRunAt = row.updatedAt;
    }
  }

  const out: MiniAppRunStatsRow[] = [...byPack.entries()].map(([packId, acc]) => ({
    packId,
    packTitle: packTitle(packId),
    runs: acc.runs,
    itemsScanned: acc.itemsScanned,
    modelCalls: acc.modelCalls,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheHitRatio: acc.modelDecided > 0 ? acc.cacheHits / acc.modelDecided : null,
    paused: acc.paused,
    canceled: acc.canceled,
    failed: acc.failed,
    lastRunAt: acc.lastRunAt,
  }));
  out.sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
  return { windowDays, rows: out };
}
