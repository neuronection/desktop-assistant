import type { PackVerdict } from '@shared/app-pack';
import type { MiniAppRunItemRow } from './store';

export interface RunTreeCounts {
  keep: number;
  ask: number;
  candidate: number;
}

export interface RunTreeDirectory {
  /** Relative directory path; '' is the run root. */
  path: string;
  directCounts: RunTreeCounts;
  totalCounts: RunTreeCounts;
  /** Summed direct item sizes per verdict; null when any contributing item lacks stored size (pre-meta runs) — honesty beats a wrong number. */
  sizeByVerdict: { keep: number | null; ask: number | null; candidate: number | null };
  totalSizeByVerdict: { keep: number | null; ask: number | null; candidate: number | null };
}

export interface RunTreeView {
  runId: string;
  directories: RunTreeDirectory[];
}

const VERDICTS: readonly PackVerdict[] = ['keep', 'ask', 'candidate'];

function emptyCounts(): RunTreeCounts {
  return { keep: 0, ask: 0, candidate: 0 };
}

interface MutableDirectory {
  path: string;
  directCounts: RunTreeCounts;
  totalCounts: RunTreeCounts;
  sizeSum: RunTreeCounts;
  sizeUnknown: Record<'keep' | 'ask' | 'candidate', boolean>;
  totalSizeSum: RunTreeCounts;
  totalSizeUnknown: Record<'keep' | 'ask' | 'candidate', boolean>;
}

function emptyUnknown(): Record<'keep' | 'ask' | 'candidate', boolean> {
  return { keep: false, ask: false, candidate: false };
}

function bump(counts: RunTreeCounts, verdict: PackVerdict): void {
  if (verdict === 'keep' || verdict === 'ask' || verdict === 'candidate') {
    counts[verdict] += 1;
  }
}

function addSize(sum: RunTreeCounts, unknown: Record<'keep' | 'ask' | 'candidate', boolean>, verdict: PackVerdict, itemSize: number | null): void {
  if (verdict !== 'keep' && verdict !== 'ask' && verdict !== 'candidate') {
    return;
  }
  if (itemSize === null) {
    unknown[verdict] = true;
    return;
  }
  sum[verdict] += itemSize;
}

function finalizeSize(sum: RunTreeCounts, unknown: Record<'keep' | 'ask' | 'candidate', boolean>): { keep: number | null; ask: number | null; candidate: number | null } {
  return {
    keep: unknown.keep ? null : sum.keep,
    ask: unknown.ask ? null : sum.ask,
    candidate: unknown.candidate ? null : sum.candidate,
  };
}

export function directoryOf(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index >= 0 ? relPath.slice(0, index) : '';
}

/**
 * The directory index (plan 51 S3.4): one bounded reduce over a run's
 * FULL item set — per directory, direct + total file counts by verdict
 * and size sums aggregated bottom-up. Pure; cached per run by
 * RunService (delta-adjusted on overrides, never re-reduced per call).
 */
export function reduceRunTree(runId: string, items: MiniAppRunItemRow[]): RunTreeView {
  const dirs = new Map<string, MutableDirectory>();
  const dirAt = (path: string): MutableDirectory => {
    let dir = dirs.get(path);
    if (!dir) {
      dir = { path, directCounts: emptyCounts(), totalCounts: emptyCounts(), sizeSum: emptyCounts(), sizeUnknown: emptyUnknown(), totalSizeSum: emptyCounts(), totalSizeUnknown: emptyUnknown() };
      dirs.set(path, dir);
    }
    return dir;
  };
  dirAt('');
  for (const item of items) {
    const dirPath = directoryOf(item.relPath);
    const size = itemMetaSize(item);
    const dir = dirAt(dirPath);
    bump(dir.directCounts, item.verdict);
    addSize(dir.sizeSum, dir.sizeUnknown, item.verdict, size);
    let cursor = dirPath;
    while (true) {
      const ancestor = dirAt(cursor);
      bump(ancestor.totalCounts, item.verdict);
      addSize(ancestor.totalSizeSum, ancestor.totalSizeUnknown, item.verdict, size);
      if (cursor === '') {
        break;
      }
      const index = cursor.lastIndexOf('/');
      cursor = index >= 0 ? cursor.slice(0, index) : '';
    }
  }
  return {
    runId,
    directories: [...dirs.values()]
      .map((dir) => ({
        path: dir.path,
        directCounts: dir.directCounts,
        totalCounts: dir.totalCounts,
        sizeByVerdict: finalizeSize(dir.sizeSum, dir.sizeUnknown),
        totalSizeByVerdict: finalizeSize(dir.totalSizeSum, dir.totalSizeUnknown),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function itemMetaSize(item: MiniAppRunItemRow): number | null {
  const meta = item.evidence?.meta as { size?: unknown } | undefined;
  return typeof meta?.size === 'number' ? meta.size : null;
}

/**
 * Delta adjustment for one override — the cached index shifts the
 * item's old verdict to the new one along its directory chain instead
 * of re-reducing up to fileCap rows: total counts on every ancestor,
 * direct counts only on the item's own directory. `oldSize` is the
 * item's stored size before the override (overrides rewrite evidence,
 * so the size becomes unknown — the new verdict's size bucket drops to
 * null and the old verdict's loses the item's contribution).
 */
export function adjustTreeForVerdict(view: RunTreeView, relPath: string, oldVerdict: PackVerdict, newVerdict: PackVerdict, oldSize: number | null): void {
  if (oldVerdict === newVerdict) {
    return;
  }
  const byPath = new Map(view.directories.map((dir) => [dir.path, dir]));
  const ownDir = directoryOf(relPath);
  let cursor = ownDir;
  let first = true;
  while (true) {
    const dir = byPath.get(cursor);
    if (dir) {
      if (oldVerdict === 'keep' || oldVerdict === 'ask' || oldVerdict === 'candidate') {
        if (first) {
          dir.directCounts[oldVerdict] = Math.max(0, dir.directCounts[oldVerdict] - 1);
          if (oldSize !== null && dir.sizeByVerdict[oldVerdict] !== null) {
            dir.sizeByVerdict[oldVerdict] = Math.max(0, (dir.sizeByVerdict[oldVerdict] ?? 0) - oldSize);
          }
        }
        dir.totalCounts[oldVerdict] = Math.max(0, dir.totalCounts[oldVerdict] - 1);
        if (oldSize !== null && dir.totalSizeByVerdict[oldVerdict] !== null) {
          dir.totalSizeByVerdict[oldVerdict] = Math.max(0, (dir.totalSizeByVerdict[oldVerdict] ?? 0) - oldSize);
        }
      }
      if (newVerdict === 'keep' || newVerdict === 'ask' || newVerdict === 'candidate') {
        if (first) {
          dir.directCounts[newVerdict] += 1;
          dir.sizeByVerdict[newVerdict] = null;
        }
        dir.totalCounts[newVerdict] += 1;
        dir.totalSizeByVerdict[newVerdict] = null;
      }
    }
    first = false;
    if (cursor === '') {
      break;
    }
    const index = cursor.lastIndexOf('/');
    cursor = index >= 0 ? cursor.slice(0, index) : '';
  }
}
