import type { PackError, PackRunStatus } from '@shared/app-pack';

export interface PackRunEntry {
  id: string;
  packId: string;
  label: string;
  status: PackRunStatus;
  startedAt: number;
  updatedAt: number;
  progress: { done: number; total: number } | null;
}

export interface PackRunBridgeDeps {
  newId(): string;
  now(): number;
}

/**
 * The run bridge (plan 26 S2): start/progress/cancel ONLY — packs can
 * address their own runs and nothing else. In-memory today; the S3
 * RunService layers persistence, checkpointing and budgets on this seam.
 * Cancellation rides AbortControllers the runner owns.
 */
export class PackRunBridge {
  private readonly runs = new Map<string, { entry: PackRunEntry; controller: AbortController }>();

  constructor(private readonly deps: PackRunBridgeDeps) {}

  start(packId: string, runId: string, label: string): { ok: true; entry: PackRunEntry } | { ok: false; error: PackError } {
    if (this.runs.has(runId)) {
      return { ok: false, error: { code: 'invalid', detail: { reason: 'run id already active' } } };
    }
    const now = this.deps.now();
    const entry: PackRunEntry = { id: runId, packId, label, status: 'running', startedAt: now, updatedAt: now, progress: null };
    this.runs.set(runId, { entry, controller: new AbortController() });
    return { ok: true, entry };
  }

  /** Only the owning pack's run may be addressed; anything else is not-found. */
  private locate(packId: string, runId: string): { entry: PackRunEntry; controller: AbortController } | null {
    const run = this.runs.get(runId);
    if (!run || run.entry.packId !== packId) {
      return null;
    }
    return run;
  }

  progress(packId: string, runId: string, done: number, total: number): boolean {
    const run = this.locate(packId, runId);
    if (!run) {
      return false;
    }
    run.entry = { ...run.entry, progress: { done, total }, updatedAt: this.deps.now() };
    this.runs.set(runId, run);
    return true;
  }

  signal(packId: string, runId: string): AbortSignal | null {
    return this.locate(packId, runId)?.controller.signal ?? null;
  }

  cancel(packId: string, runId: string): { ok: true } | { ok: false; error: PackError } {
    const run = this.locate(packId, runId);
    if (!run) {
      return { ok: false, error: { code: 'not-found', detail: { runId } } };
    }
    run.controller.abort();
    run.entry = { ...run.entry, status: 'canceled', updatedAt: this.deps.now() };
    this.runs.set(runId, run);
    return { ok: true };
  }

  finish(packId: string, runId: string, status: Extract<PackRunStatus, 'done' | 'failed' | 'paused'>): boolean {
    const run = this.locate(packId, runId);
    if (!run) {
      return false;
    }
    run.entry = { ...run.entry, status, updatedAt: this.deps.now() };
    this.runs.set(runId, run);
    if (status !== 'paused') {
      this.runs.delete(runId);
    }
    return true;
  }

  resume(packId: string, runId: string): { ok: true } | { ok: false; error: PackError } {
    const run = this.locate(packId, runId);
    if (!run) {
      return { ok: false, error: { code: 'not-found', detail: { runId } } };
    }
    if (run.entry.status !== 'paused' && run.entry.status !== 'interrupted') {
      return { ok: false, error: { code: 'invalid', detail: { runId, status: run.entry.status } } };
    }
    run.controller.abort();
    run.entry = { ...run.entry, status: 'running', updatedAt: this.deps.now() };
    this.runs.set(runId, { entry: run.entry, controller: new AbortController() });
    return { ok: true };
  }

  get(packId: string, runId: string): PackRunEntry | null {
    return this.locate(packId, runId)?.entry ?? null;
  }
}
