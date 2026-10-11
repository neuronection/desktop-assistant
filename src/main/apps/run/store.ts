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
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  conversationId: string | null;
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
  /** The walk hit its file/time cap — the scan is partial (surfaced honestly). */
  scanTruncated?: boolean;
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

export type MiniAppRunPatch = Partial<Pick<MiniAppRunRow, 'status' | 'totals' | 'estimateCalls' | 'actualCalls' | 'error' | 'finishedAt' | 'inputTokens' | 'outputTokens'>>;

export interface MiniAppFeedbackRow {
  packId: string;
  rootPath: string;
  relPath: string;
  verdict: PackVerdict;
  source: 'override' | 'exclude';
  note?: string;
}

/**
 * Persistence seam for runs (plan 26 S3): the runner checkpoints each
 * item as it is computed; the cache lookup spans runs by the verdict key
 * (packId, packVersion, configHash, engineId, fingerprint). Feedback
 * (S5) persists user overrides readable by later runs.
 */
export interface MiniAppRunStore {
  createRun(row: MiniAppRunRow): Promise<void>;
  updateRun(id: string, patch: MiniAppRunPatch): Promise<void>;
  getRun(id: string): Promise<MiniAppRunRow | null>;
  runsByStatus(status: PackRunStatus): Promise<MiniAppRunRow[]>;
  recentRuns(packId?: string, limit?: number): Promise<MiniAppRunRow[]>;
  /** Every run row, newest first — bounded by retention; stats and pruning read this. */
  allRuns(): Promise<MiniAppRunRow[]>;
  appendItem(row: MiniAppRunItemRow): Promise<void>;
  itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]>;
  updateItemVerdict(runId: string, relPath: string, verdict: PackVerdict, decidedBy: string): Promise<boolean>;
  findCachedVerdict(key: {
    packId: string;
    packVersion: string;
    configHash: string;
    engineId: string;
    fingerprint: string;
  }): Promise<Omit<MiniAppRunItemRow, 'runId'> | null>;
  upsertFeedback(row: MiniAppFeedbackRow): Promise<void>;
  feedbackFor(packId: string, rootPath: string): Promise<Map<string, MiniAppFeedbackRow>>;
  feedbackList(packId: string): Promise<MiniAppFeedbackRow[]>;
  feedbackClear(packId: string, relPath?: string): Promise<number>;
  /** Retention: keep the newest `keepPerPack` finished runs per pack (paused/interrupted always kept); returns rows pruned. */
  pruneRuns(keepPerPack: number): Promise<number>;
}
