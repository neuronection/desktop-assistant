import { createHash } from 'node:crypto';
import { PACK_LIMITS, type PackError, type ValidatedPack } from '@shared/app-pack';
import type { FsResult, PackFs } from '../capabilities/fs';
import type { PackAskResult } from '../capabilities/decide';
import type { PackRunBridge } from '../capabilities/run';
import { runAssessment, type RunnerEvent } from '../runner/runner';
import type { MiniAppRunItemRow, MiniAppRunPatch, MiniAppRunRow, MiniAppRunStore, MiniAppRunTotals } from './store';

export interface ServiceRunEvent {
  type: string;
  runId: string;
  packId: string;
  status?: string;
  estimateCalls?: number;
  phase?: string;
  done?: number;
  total?: number;
  /** run:items batch size (coalesced item decisions since the last flush). */
  count?: number;
  relPath?: string;
  verdict?: string;
  decidedBy?: string;
  error?: PackError | null;
}

export interface MiniAppRunServiceDeps {
  store: MiniAppRunStore;
  runBridge: PackRunBridge;
  getPack(packId: string): { pack: ValidatedPack; config: Record<string, unknown>; title: string } | null;
  openFs(pack: ValidatedPack, root: string): Promise<FsResult<PackFs>>;
  decideFor(pack: ValidatedPack): { ask: (input: string, questions: never) => Promise<PackAskResult> } | null;
  resolveEngineId(): Promise<{ ok: true; engineId: string } | { ok: false; error: PackError }>;
  broadcast(event: ServiceRunEvent): void;
  createConversation(title: string): Promise<{ id: string }>;
  createRunMessage(conversationId: string, content: string, metadata: Record<string, unknown>): Promise<{ id: string }>;
  updateRunMessage(messageId: string, content: string, metadata: Record<string, unknown>): Promise<void>;
  notify(title: string, body: string): void;
  packTitle(packId: string): string;
  now(): number;
  newId(): string;
  defaultMaxModelCalls?: number;
}

export type StartRunResult = { ok: true; runId: string; estimateCalls: number } | { ok: false; error: PackError };
export type RunOpResult = { ok: true } | { ok: false; error: PackError };

/**
 * RunService (plan 26 S3): main-owned run orchestration over the runner —
 * one active run per pack, persisted rows + per-item checkpoints, budget
 * pre-flight + resumable exhaustion, cancellation, and boot
 * reconciliation of orphaned runs. The renderer never orchestrates runs;
 * S4 wires `broadcast` to windows.
 */
export class MiniAppRunService {
  private readonly active = new Map<string, string>();
  private readonly cards = new Map<string, string>();

  constructor(private readonly deps: MiniAppRunServiceDeps) {}

  async reconcileBoot(): Promise<number> {
    const orphaned = await this.deps.store.runsByStatus('running');
    for (const run of orphaned) {
      await this.deps.store.updateRun(run.id, { status: 'interrupted', error: 'interrupted by restart' });
    }
    await this.deps.store.pruneRuns(PACK_LIMITS.runsRetainedPerPack).catch(() => 0);
    return orphaned.length;
  }

  async start(packId: string, rootPath: string, options: { maxModelCalls?: number; disallowArm?: boolean } = {}): Promise<StartRunResult> {
    if (this.active.has(packId)) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'a run is already active for this pack' } } };
    }
    const resolved = this.deps.getPack(packId);
    if (!resolved) {
      return { ok: false, error: { code: 'not-found', detail: { packId } } };
    }
    const manifest = resolved.pack.manifest;
    let engineId = 'none';
    if (manifest.kind === 'assessment' && manifest.run.decide) {
      const engine = await this.deps.resolveEngineId();
      if (!engine.ok) {
        return { ok: false, error: engine.error };
      }
      engineId = engine.engineId;
    }
    const fsResult = await this.deps.openFs(resolved.pack, rootPath);
    if (!fsResult.ok) {
      return { ok: false, error: fsResult.error };
    }
    const runId = this.deps.newId();
    const now = this.deps.now();
    const configHash = canonicalConfigHash(resolved.config);
    const conversation = await this.deps.createConversation(`${this.deps.packTitle(packId)} — ${rootPath.split('/').pop() ?? rootPath}`);
    await this.deps.store.createRun({
      id: runId,
      packId,
      packVersion: manifest.version,
      rootPath: fsResult.value.rootPath,
      configHash,
      engineId,
      status: 'running',
      totals: null,
      estimateCalls: 0,
      actualCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
      conversationId: conversation.id,
      disallowArm: options.disallowArm === true,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    });
    const card = await this.deps.createRunMessage(
      conversation.id,
      this.cardMarkdown(packId, 'running', 0, 0),
      this.cardMetadata(runId, packId, 'running')
    );
    this.cards.set(runId, card.id);
    const started = this.deps.runBridge.start(packId, runId, `${packId}:${rootPath}`);
    if (!started.ok) {
      await this.deps.store.updateRun(runId, { status: 'failed', error: String(started.error.detail?.message ?? 'run bridge rejected the run'), finishedAt: this.deps.now() });
      return { ok: false, error: started.error };
    }
    this.active.set(packId, runId);
    this.deps.broadcast({ type: 'run:started', runId, packId, status: 'running' });
    void this.execute(runId, resolved.pack, resolved.config, fsResult.value, options.maxModelCalls ?? this.deps.defaultMaxModelCalls ?? 500)
      .catch(async (error: unknown) => {
        await this.deps.store.updateRun(runId, {
          status: 'failed',
          error: String((error as Error)?.message ?? error).slice(0, 500),
          finishedAt: this.deps.now(),
        });
        this.deps.runBridge.finish(packId, runId, 'failed');
        this.deps.broadcast({ type: 'run:failed', runId, packId, status: 'failed' });
        this.active.delete(packId);
      });
    return { ok: true, runId, estimateCalls: 0 };
  }

  async cancel(runId: string): Promise<RunOpResult> {
    const run = await this.deps.store.getRun(runId);
    if (!run) {
      return { ok: false, error: { code: 'not-found', detail: { runId } } };
    }
    const result = this.deps.runBridge.cancel(run.packId, runId);
    if (!result.ok) {
      return result;
    }
    this.active.delete(run.packId);
    return { ok: true };
  }

  async resume(runId: string): Promise<RunOpResult> {
    const run = await this.deps.store.getRun(runId);
    if (!run) {
      return { ok: false, error: { code: 'not-found', detail: { runId } } };
    }
    if (run.status !== 'paused' && run.status !== 'interrupted') {
      return { ok: false, error: { code: 'invalid', detail: { runId, actual: run.status } } };
    }
    if (this.active.has(run.packId)) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'a run is already active for this pack' } } };
    }
    const resolved = this.deps.getPack(run.packId);
    if (!resolved) {
      return { ok: false, error: { code: 'not-found', detail: { packId: run.packId } } };
    }
    const manifest = resolved.pack.manifest;
    const stale =
      manifest.kind !== 'assessment' ||
      manifest.version !== run.packVersion ||
      canonicalConfigHash(resolved.config) !== run.configHash;
    if (stale) {
      return {
        ok: false,
        error: { code: 'invalid', detail: { message: 'pack version or config changed since the run — start a new run' } },
      };
    }
    let engineId = 'none';
    if (manifest.run.decide) {
      const engine = await this.deps.resolveEngineId();
      if (!engine.ok) {
        return { ok: false, error: engine.error };
      }
      engineId = engine.engineId;
    }
    if (engineId !== run.engineId) {
      return { ok: false, error: { code: 'invalid', detail: { message: 'decision engine changed — start a new run' } } };
    }
    const fsResult = await this.deps.openFs(resolved.pack, run.rootPath);
    if (!fsResult.ok) {
      return { ok: false, error: fsResult.error };
    }
    const resumed = this.deps.runBridge.resume(run.packId, runId);
    if (!resumed.ok) {
      return resumed;
    }
    this.active.set(run.packId, runId);
    await this.deps.store.updateRun(runId, { status: 'running', error: null });
    this.deps.broadcast({ type: 'run:resumed', runId, packId: run.packId, status: 'running' });
    void this.execute(runId, resolved.pack, resolved.config, fsResult.value, undefined)
      .catch(async (error: unknown) => {
        await this.deps.store.updateRun(runId, {
          status: 'failed',
          error: String((error as Error)?.message ?? error).slice(0, 500),
          finishedAt: this.deps.now(),
        });
        this.deps.runBridge.finish(run.packId, runId, 'failed');
        this.active.delete(run.packId);
      });
    return { ok: true };
  }

  getRun(runId: string): Promise<MiniAppRunRow | null> {
    return this.deps.store.getRun(runId);
  }

  itemsOfRun(runId: string): Promise<MiniAppRunItemRow[]> {
    return this.deps.store.itemsOfRun(runId);
  }

  private async execute(
    runId: string,
    pack: ValidatedPack,
    config: Record<string, unknown>,
    fs: PackFs,
    maxModelCalls: number | undefined
  ): Promise<void> {
    const run = await this.deps.store.getRun(runId);
    if (!run) {
      return;
    }
    const decide = this.deps.decideFor(pack);
    const signal = this.deps.runBridge.signal(run.packId, runId);
    if (!signal) {
      return;
    }
    const feedback = await this.deps.store.feedbackFor(run.packId, run.rootPath);
    const feedbackMap = new Map<string, { verdict: 'keep' | 'ask' | 'candidate'; source: string }>();
    for (const [relPath, row] of feedback) {
      feedbackMap.set(relPath, { verdict: row.verdict, source: row.source });
    }
    let firstEstimate = true;
    const coalescer = new EventCoalescer(this.deps.now);
    const outcome = await runAssessment(pack, config, {
      runId,
      fs,
      decide,
      feedback: feedbackMap,
      items: {
        appendItem: (row) => this.deps.store.appendItem(row),
        findCachedVerdict: (key) => this.deps.store.findCachedVerdict(key),
      },
      key: { packId: run.packId, packVersion: run.packVersion, configHash: run.configHash, engineId: run.engineId },
      rootPath: run.rootPath,
      emit: (event) => {
        if (event.type === 'progress' && event.phase === 'decide' && firstEstimate) {
          firstEstimate = false;
          void this.deps.store.updateRun(runId, { estimateCalls: event.total });
          this.deps.broadcast({ type: 'run:progress', runId, packId: run.packId, estimateCalls: event.total });
          return;
        }
        coalescer.push(event, (payload) => {
          this.deps.broadcast({ ...payload, runId, packId: run.packId } as ServiceRunEvent);
        });
      },
      signal,
      maxModelCalls: maxModelCalls ?? 500,
      now: this.deps.now,
    });
    coalescer.flush((payload) => {
      this.deps.broadcast({ ...payload, runId, packId: run.packId } as ServiceRunEvent);
    });
    const mergedTotals = run.totals
      ? {
          scanned: outcome.totals.scanned,
          keep: run.totals.keep + outcome.totals.keep,
          ask: run.totals.ask + outcome.totals.ask,
          candidate: run.totals.candidate + outcome.totals.candidate,
          ruleDecided: run.totals.ruleDecided + outcome.totals.ruleDecided,
          modelDecided: run.totals.modelDecided + outcome.totals.modelDecided,
          cacheHits: run.totals.cacheHits + outcome.totals.cacheHits,
          pending: outcome.totals.pending,
        }
      : outcome.totals;
    const actualCalls = (run.actualCalls ?? 0) + outcome.actualCalls;
    const inputTokens = (run.inputTokens ?? 0) + outcome.usage.inputTokens;
    const outputTokens = (run.outputTokens ?? 0) + outcome.usage.outputTokens;
    const patch: MiniAppRunPatch = {
      status: outcome.status === 'done' ? 'done' : outcome.status,
      totals: mergedTotals,
      actualCalls,
      inputTokens,
      outputTokens,
      ...(outcome.error ? { error: JSON.stringify(outcome.error).slice(0, 500) } : {}),
      ...(outcome.status === 'done' || outcome.status === 'failed' || outcome.status === 'canceled'
        ? { finishedAt: this.deps.now() }
        : {}),
    };
    await this.deps.store.updateRun(runId, patch);
    this.deps.runBridge.finish(run.packId, runId, outcome.status);
    this.active.delete(run.packId);
    const cardId = this.cards.get(runId);
    if (cardId) {
      this.cards.delete(runId);
      await this.deps.updateRunMessage(
        cardId,
        this.cardMarkdown(run.packId, outcome.status, actualCalls, outcome.estimateCalls, mergedTotals, inputTokens, outputTokens, outcome.error ? JSON.stringify(outcome.error) : undefined),
        this.cardMetadata(runId, run.packId, outcome.status, mergedTotals, outcome.estimateCalls, actualCalls, inputTokens, outputTokens, outcome.error ? JSON.stringify(outcome.error) : undefined)
      );
    }
    this.notifyOutcome(run.packId, outcome.status, mergedTotals);
    this.deps.broadcast({
      type: outcome.status === 'done' ? 'run:finished' : `run:${outcome.status}`,
      runId,
      packId: run.packId,
      status: outcome.status,
      error: outcome.error,
    });
  }

  private notifyOutcome(packId: string, status: RunnerStatusLike, totals: { candidate: number; ask: number; keep: number } | null): void {
    const title = this.deps.packTitle(packId);
    if (status === 'done') {
      this.deps.notify(title, totals ? `${totals.keep} keep · ${totals.ask} ask · ${totals.candidate} candidate` : 'Run complete');
      return;
    }
    if (status === 'paused') {
      this.deps.notify(title, 'Run paused — items pending, resume when ready');
      return;
    }
    if (status === 'failed') {
      this.deps.notify(title, 'Run failed — see the run history for details');
    }
  }

  private cardMetadata(
    runId: string,
    packId: string,
    status: string,
    totals?: MiniAppRunTotals,
    estimateCalls?: number,
    actualCalls?: number,
    inputTokens?: number,
    outputTokens?: number,
    error?: string
  ): Record<string, unknown> {
    return {
      miniAppRun: {
        runId,
        packId,
        packTitle: this.deps.packTitle(packId),
        status,
        rootPath: '',
        ...(totals ? { totals } : {}),
        ...(estimateCalls !== undefined ? { estimateCalls } : {}),
        ...(actualCalls !== undefined ? { actualCalls } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(error ? { error } : {}),
      },
    };
  }

  private cardMarkdown(
    packId: string,
    status: string,
    actualCalls: number,
    estimateCalls: number,
    totals?: MiniAppRunTotals,
    inputTokens?: number,
    outputTokens?: number,
    error?: string
  ): string {
    const title = this.deps.packTitle(packId);
    const lines = [`**${title}** — run ${status}.`];
    if (totals) {
      lines.push(
        `${totals.scanned} files scanned → **${totals.keep} keep · ${totals.ask} ask · ${totals.candidate} candidate** (${totals.ruleDecided} by rules, ${totals.modelDecided} by the model, ${totals.cacheHits} cached).`
      );
    }
    if (estimateCalls > 0 || actualCalls > 0) {
      lines.push(
        `Model calls: ${actualCalls}${estimateCalls > 0 ? ` of ~${estimateCalls} estimated` : ''}${inputTokens || outputTokens ? ` · ${inputTokens} in / ${outputTokens} out tokens` : ''}.`
      );
    }
    if (totals?.pending) {
      lines.push(`${totals.pending} items pending — resume to continue.`);
    }
    if (error) {
      lines.push(`Error: ${error}`);
    }
    return lines.join('\n\n');
  }

  recentRuns(packId?: string, limit?: number): Promise<MiniAppRunRow[]> {
    return this.deps.store.recentRuns(packId, limit);
  }
}

type RunnerStatusLike = 'done' | 'paused' | 'canceled' | 'failed';

/**
 * Event coalescer (audit finding: per-item broadcasts storm every
 * window on large runs). Item events buffer into batched `run:items`
 * counts and decide-phase progress flushes at most every 250 ms;
 * terminal-adjacent flushes are immediate via `flush()`.
 */
export class EventCoalescer {
  private bufferedItems = 0;
  private lastVerdict: string | null = null;
  private lastProgress: { done: number; total: number } | null = null;
  private lastFlush = 0;

  constructor(
    private readonly now: () => number,
    private readonly intervalMs = 250
  ) {}

  push(event: { type: string; relPath?: string; verdict?: string; decidedBy?: string; phase?: string; done?: number; total?: number }, emit: (payload: Record<string, unknown>) => void): void {
    if (event.type === 'item') {
      this.bufferedItems += 1;
      this.lastVerdict = event.verdict ?? null;
    } else if (event.type === 'progress' && event.phase === 'decide') {
      this.lastProgress = { done: event.done ?? 0, total: event.total ?? 0 };
    } else {
      return;
    }
    if (this.now() - this.lastFlush >= this.intervalMs) {
      this.flush(emit);
    }
  }

  flush(emit: (payload: Record<string, unknown>) => void): void {
    if (this.bufferedItems > 0) {
      emit({ type: 'run:items', count: this.bufferedItems, ...(this.lastVerdict ? { verdict: this.lastVerdict } : {}) });
      this.bufferedItems = 0;
      this.lastVerdict = null;
    }
    if (this.lastProgress) {
      emit({ type: 'run:progress', phase: 'decide', done: this.lastProgress.done, total: this.lastProgress.total });
      this.lastProgress = null;
    }
    this.lastFlush = this.now();
  }
}

export function canonicalConfigHash(config: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortKeys(config));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)])
    );
  }
  return value;
}
