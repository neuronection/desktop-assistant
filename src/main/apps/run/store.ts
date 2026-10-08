import type { PackRunStatus, PackVerdict } from '@shared/app-pack';

export interface MiniAppRunRow {
  id: string;
  packId: string;
  packVersion: string;
  rootPath: string;
  configHash: string;
  engineId: string;
  status: PackRunStatus;
  totals: MiniAppRunTotals | null;
  estimateCalls: number;
  actualCalls: number;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface MiniAppRunTotals {
  scanned: number;
  keep: number;
  ask: number;
  candidate: number;
  ruleDecided: number;
  modelDecided: number;
  cacheHits: number;
  pending: number;
}

export interface MiniAppRunItemRow {
  runId: string;
  packId: string;
  packVersion: string;
  configHash: string;
  engineId: string;
  fingerprint: string;
  relPath: string;
  verdict: PackVerdict;
  confidence: number | null;
  decidedBy: string;
  evidence: Record<string, unknown> | null;
  updatedAt: number;
}

export type MiniAppRunPatch = Partial<Pick<MiniAppRunRow, 'status' | 'totals' | 'estimateCalls' | 'actualCalls' | 'error' | 'finishedAt'>>;

/**
 * Persistence seam for runs (plan 26 S3): the runner checkpoints each
 * item as it is computed; the cache lookup spans runs by the verdict key
 * (packId, packVersion, configHash, engineId, fingerprint).
 */
export interface MiniAppRunStore {
  createRun(row: MiniAppRunRow): Promise<void>;
  updateRun(id: string, patch: MiniAppRunPatch): Promise<void>;
  getRun(id: string): Promise<MiniAppRunRow | null>;
  runsByStatus(status: PackRunStatus): Promise<MiniAppRunRow[]>;
  appendItem(row: MiniAppRunItemRow): Promise<void>;
  itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]>;
  findCachedVerdict(key: {
    packId: string;
    packVersion: string;
    configHash: string;
    engineId: string;
    fingerprint: string;
  }): Promise<Omit<MiniAppRunItemRow, 'runId'> | null>;
}
