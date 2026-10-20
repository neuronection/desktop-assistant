import { extname } from 'path';
import type { ValidatedPack } from '@shared/app-pack';
import { PACK_LIMITS } from '@shared/app-pack';
import type { AssessmentPackManifest } from '@shared/app-pack';
import type { PackError, PackVerdict } from '@shared/app-pack';
import type { PackFs } from '../capabilities/fs';
import type { PackAskResult } from '../capabilities/decide';
import { classifyItem, composeVerdict, evaluateCondition, type SignalContext } from './evaluate';
import type { MiniAppRunItemRow, MiniAppRunTotals } from '../run/store';
import { runnerFingerprint } from '../run/fingerprint';
import { PACK_HOST_SENSITIVE_BASELINE } from '@shared/app-pack';
import { globToRegex, matchesGlob } from '@main/ai/tools/native/file-search';

export type RunnerPhase = 'scan' | 'classify' | 'decide' | 'compose';

export type RunnerEvent =
  | { type: 'progress'; phase: RunnerPhase; done: number; total: number }
  | { type: 'item'; relPath: string; verdict: PackVerdict; decidedBy: string };

export interface RunnerDecidedItem {
  relPath: string;
  fingerprint: string;
  verdict: PackVerdict;
  confidence: number | null;
  decidedBy: string;
  evidence: Record<string, unknown> | null;
}

export type RunnerStatus = 'done' | 'paused' | 'canceled' | 'failed';

export interface RunnerUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RunnerOutcome {
  status: RunnerStatus;
  totals: MiniAppRunTotals;
  estimateCalls: number;
  actualCalls: number;
  usage: RunnerUsage;
  error: PackError | null;
  items: RunnerDecidedItem[];
}

export interface RunnerItemSeam {
  appendItem(row: MiniAppRunItemRow): Promise<void>;
  findCachedVerdict(key: {
    packId: string;
    packVersion: string;
    configHash: string;
    engineId: string;
    fingerprint: string;
  }): Promise<Omit<MiniAppRunItemRow, 'runId'> | null>;
}

export interface RunnerDeps {
  runId: string;
  fs: PackFs;
  decide: { ask(input: string, questions: AssessmentPackManifest['run']['decide'] extends undefined ? never : NonNullable<AssessmentPackManifest['run']['decide']>['questions']): Promise<PackAskResult>; /** Shared funnel slot count (plan 28 D3) — absent → the 4-slot cap. */ slots?: number } | null;
  items: RunnerItemSeam;
  key: { packId: string; packVersion: string; configHash: string; engineId: string };
  rootPath: string;
  emit(event: RunnerEvent): void;
  signal: AbortSignal;
  maxModelCalls: number;
  now(): number;
  /** User overrides (S5) — a verdict for a relPath wins over rules and the model. */
  feedback?: Map<string, { verdict: PackVerdict; source: string }>;
}

const DEFAULT_MAX_MODEL_CALLS = 500;
const MAX_DECIDE_CONCURRENCY = 4;

function fileNameOf(relative: string): string {
  const segments = relative.split('/');
  return segments[segments.length - 1] ?? relative;
}

const SENSITIVE_MATCHERS = PACK_HOST_SENSITIVE_BASELINE.map((glob) => ({ glob, regex: globToRegex(glob), hasSlash: glob.includes('/') }));

/** Contract `privacy.hostBaseline`: the host union is enforced regardless of pack declaration. */
function isHostSensitive(relativePath: string): boolean {
  return SENSITIVE_MATCHERS.some((entry) => matchesGlob(relativePath, entry.regex, entry.hasSlash));
}

/**
 * The assessment pipeline (plan 26 S3): scan → classify → decide →
 * compose, checkpointing every verdict as it is computed. Deterministic
 * rules finalize the decidable majority; the model is asked only about
 * the residual; verdicts cache by the contract key so resume and re-runs
 * never re-pay a decided item. Budget exhaustion pauses cleanly; provider
 * failure fails the run (resumable); cancellation is honored between
 * items. Every abort leaves already-decided items persisted.
 */
export async function runAssessment(
  pack: ValidatedPack,
  effectiveConfig: Record<string, unknown>,
  deps: RunnerDeps
): Promise<RunnerOutcome> {
  const manifest = pack.manifest as AssessmentPackManifest;
  const run = manifest.run;
  const totals: MiniAppRunTotals = {
    scanned: 0, keep: 0, ask: 0, candidate: 0, ruleDecided: 0, modelDecided: 0, cacheHits: 0, pending: 0,
  };
  const items: RunnerDecidedItem[] = [];
  const estimate = { captured: 0 };
  const usage: RunnerUsage = { inputTokens: 0, outputTokens: 0 };
  let actualCalls = 0;
  const maxModelCalls = deps.maxModelCalls > 0 ? deps.maxModelCalls : DEFAULT_MAX_MODEL_CALLS;

  const persisted = async (item: RunnerDecidedItem): Promise<void> => {
    items.push(item);
    await deps.items.appendItem({
      runId: deps.runId,
      ...deps.key,
      fingerprint: item.fingerprint,
      relPath: item.relPath,
      verdict: item.verdict,
      confidence: item.confidence,
      decidedBy: item.decidedBy,
      evidence: item.evidence,
      updatedAt: deps.now(),
    });
    deps.emit({ type: 'item', relPath: item.relPath, verdict: item.verdict, decidedBy: item.decidedBy });
  };

  const scanned: { relative: string; size: number; mtimeMs: number }[] = [];
  const abort = (): boolean => deps.signal.aborted;
  const fileCap = run.scan.fileCap ?? PACK_LIMITS.scanFileCapDefault;
  const scanBudget = { files: 0, truncated: false, deadline: deps.now() + Math.min(300_000, Math.max(30_000, fileCap * 10)) };
  await deps.fs.scan(
    {
      includeHidden: run.scan.includeHidden ?? false,
      excludeGlobs: run.scan.excludeGlobs ?? [],
      fileCap,
      maxDepth: run.scan.maxDepth ?? PACK_LIMITS.scanDepthDefault,
    },
    scanBudget,
    async (entry) => {
      scanned.push({ relative: entry.relative, size: entry.size, mtimeMs: entry.mtimeMs });
    }
  );
  totals.scanned = scanned.length;
  totals.scanTruncated = scanBudget.truncated;
  deps.emit({ type: 'progress', phase: 'scan', done: scanned.length, total: scanned.length });

  interface Residual {
    relative: string;
    size: number;
    mtimeMs: number;
    candidateRule: string | null;
    context: SignalContext;
  }
  const residual: Residual[] = [];
  let classified = 0;

  for (const entry of scanned) {
    if (abort()) {
      return outcome(usage, 'canceled', totals, items, actualCalls, null, estimate.captured);
    }
    const context: SignalContext = {
      meta: {
        path: entry.relative,
        name: fileNameOf(entry.relative),
        ext: extname(entry.relative).replace(/^\./, '').toLowerCase(),
        size: entry.size,
        ageDays: Math.max(0, (deps.now() - entry.mtimeMs) / 86_400_000),
      },
      config: effectiveConfig,
      matchedRules: new Set<string>(),
      answers: {},
    };
    const verdict = classifyItem(run.classify, context);
    classified += 1;
    if (classified % 50 === 0) {
      deps.emit({ type: 'progress', phase: 'classify', done: classified, total: scanned.length });
    }
    const fingerprint = runnerFingerprint(deps.rootPath, entry.relative, entry.size, entry.mtimeMs);
    if (isHostSensitive(entry.relative)) {
      totals.keep += 1;
      totals.ruleDecided += 1;
      await persisted({
        relPath: entry.relative,
        fingerprint,
        verdict: 'keep',
        confidence: null,
        decidedBy: 'rule:host-sensitive',
        evidence: { list: 'host-sensitive', note: 'matches the host sensitive baseline — never sent, never armed' },
      });
      continue;
    }
    const override = deps.feedback?.get(entry.relative);
    if (override) {
      totals.keep += override.verdict === 'keep' ? 1 : 0;
      totals.ask += override.verdict === 'ask' ? 1 : 0;
      totals.candidate += override.verdict === 'candidate' ? 1 : 0;
      totals.ruleDecided += 1;
      await persisted({
        relPath: entry.relative,
        fingerprint,
        verdict: override.verdict,
        confidence: null,
        decidedBy: `override:${override.source}`,
        evidence: { userOverride: true, source: override.source },
      });
      continue;
    }
    if (verdict.kind === 'final') {
      totals.keep += verdict.verdict === 'keep' ? 1 : 0;
      totals.ask += verdict.verdict === 'ask' ? 1 : 0;
      totals.candidate += verdict.verdict === 'candidate' ? 1 : 0;
      totals.ruleDecided += 1;
      await persisted({
        relPath: entry.relative,
        fingerprint,
        verdict: verdict.verdict,
        confidence: null,
        decidedBy: `rule:${verdict.rule}`,
        evidence: { rule: verdict.rule, list: verdict.list },
      });
      continue;
    }
    if (run.decide) {
      residual.push({ ...entry, candidateRule: verdict.candidateRule, context });
    } else {
      const finalVerdict: PackVerdict = verdict.candidateRule !== null ? 'candidate' : 'ask';
      totals.keep += 0;
      totals.ask += finalVerdict === 'ask' ? 1 : 0;
      totals.candidate += finalVerdict === 'candidate' ? 1 : 0;
      totals.ruleDecided += 1;
      await persisted({
        relPath: entry.relative,
        fingerprint,
        verdict: finalVerdict,
        confidence: null,
        decidedBy: verdict.candidateRule !== null ? `rule:${verdict.candidateRule}` : 'fallback',
        evidence: verdict.candidateRule !== null ? { rule: verdict.candidateRule, list: 'candidate' } : { fallback: true },
      });
    }
  }

  const estimateCalls = residual.length;
  estimate.captured = estimateCalls;
  deps.emit({ type: 'progress', phase: 'decide', done: 0, total: residual.length });

  if (!deps.decide) {
    totals.pending = 0;
    return outcome(usage, 'done', totals, items, 0, null, estimateCalls);
  }

  // Bounded decision window (plan 28): tasks run min(funnel slots, 4)
  // wide; persistence drains in scan order so item rows, totals and the
  // progress sequence are byte-identical to the sequential loop; the
  // budget reserves at ask time (spent + reserved never over-commits);
  // a terminal result stops launches and lets in-flight tasks settle
  // and persist (D4) — everything never persisted stays pending.
  const concurrency = Math.max(1, Math.min(deps.decide?.slots ?? MAX_DECIDE_CONCURRENCY, MAX_DECIDE_CONCURRENCY));
  const decide = deps.decide;
  type DecideTaskOutcome =
    | { index: number; kind: 'persist'; item: RunnerDecidedItem; cacheHit: boolean; modelDecided: boolean; usage: RunnerUsage | null }
    | { index: number; kind: 'stop'; status: 'paused' | 'failed' | 'canceled'; error: PackError | null };

  let spent = 0;
  let reserved = 0;
  let nextToPersist = 0;
  const settled = new Map<number, DecideTaskOutcome>();
  const inFlight = new Set<Promise<void>>();
  let settleSignal: (() => void) | null = null;

  const decideTask = async (index: number): Promise<DecideTaskOutcome> => {
    const entry = residual[index];
    let fingerprint = runnerFingerprint(deps.rootPath, entry.relative, entry.size, entry.mtimeMs);
    let excerpt: string | null = null;
    const readContextAllowed = run.decide?.readContext === true && manifest.privacy.sendsContent;
    const readContext = readContextAllowed && (!run.decide?.readContextWhen || evaluateCondition(run.decide.readContextWhen, entry.context));
    if (readContext) {
      const cap = manifest.privacy.contentCapBytes ?? PACK_LIMITS.contentExcerptMaxBytes;
      const read = await deps.fs.readExcerpt(entry.relative, cap);
      if (read.ok) {
        excerpt = read.value.buffer.toString('utf8');
        fingerprint = runnerFingerprint('', fingerprint, 0, 0, read.value.buffer.toString('hex'));
      } else {
        return {
          index,
          kind: 'persist',
          cacheHit: false,
          modelDecided: false,
          usage: null,
          item: { relPath: entry.relative, fingerprint, verdict: 'ask', confidence: null, decidedBy: 'fs-error', evidence: { error: read.error } },
        };
      }
    }

    const cached = await deps.items.findCachedVerdict({ ...deps.key, fingerprint });
    if (cached) {
      return {
        index,
        kind: 'persist',
        cacheHit: true,
        modelDecided: false,
        usage: null,
        item: {
          relPath: entry.relative,
          fingerprint,
          verdict: cached.verdict,
          confidence: cached.confidence,
          decidedBy: 'cache',
          evidence: cached.evidence,
        },
      };
    }

    if (spent + reserved >= maxModelCalls) {
      return { index, kind: 'stop', status: 'paused', error: { code: 'budget', detail: { message: 'model-call budget reached', limit: maxModelCalls } } };
    }
    reserved += 1;
    const input = buildAskInput(entry.context.meta, excerpt, effectiveConfig);
    const result = await decide.ask(input, run.decide?.questions ?? []);
    reserved -= 1;
    if (!result.ok) {
      if (result.error.code === 'canceled') {
        return { index, kind: 'stop', status: 'canceled', error: result.error };
      }
      if (abort()) {
        return { index, kind: 'stop', status: 'canceled', error: result.error };
      }
      if (result.error.code === 'rate-limited') {
        return { index, kind: 'stop', status: 'paused', error: result.error };
      }
      return { index, kind: 'stop', status: 'failed', error: result.error };
    }
    spent += 1;
    entry.context.answers = result.value.answers;
    const verdict = composeVerdict(run.compose, entry.context);
    return {
      index,
      kind: 'persist',
      cacheHit: false,
      modelDecided: true,
      usage: result.value.usage ? { inputTokens: result.value.usage.inputTokens, outputTokens: result.value.usage.outputTokens } : null,
      item: {
        relPath: entry.relative,
        fingerprint,
        verdict,
        confidence: result.value.confidence,
        decidedBy: `engine:${result.value.engine}`,
        evidence: {
          ...(entry.candidateRule ? { rule: entry.candidateRule, list: 'candidate' } : {}),
          answers: result.value.answers,
          ...(result.value.usage ? { usage: result.value.usage } : {}),
        },
      },
    };
  };

  const applyPersist = async (persistedCount: number, persistOutcome: Extract<DecideTaskOutcome, { kind: 'persist' }>): Promise<void> => {
    const item = persistOutcome.item;
    if (persistOutcome.cacheHit) {
      totals.cacheHits += 1;
    } else if (persistOutcome.modelDecided) {
      totals.modelDecided += 1;
    } else {
      totals.ask += 1;
    }
    totals.keep += item.verdict === 'keep' ? 1 : 0;
    totals.ask += item.verdict === 'ask' ? 1 : 0;
    totals.candidate += item.verdict === 'candidate' ? 1 : 0;
    if (persistOutcome.usage) {
      usage.inputTokens += persistOutcome.usage.inputTokens;
      usage.outputTokens += persistOutcome.usage.outputTokens;
    }
    await persisted(item);
    deps.emit({ type: 'progress', phase: 'decide', done: persistedCount, total: residual.length });
  };

  let launched = 0;
  let persistedCount = 0;
  let terminal: { status: 'paused' | 'failed' | 'canceled'; error: PackError | null } | null = null;

  const launch = (index: number): void => {
    const promise = decideTask(index).then((taskOutcome) => {
      settled.set(taskOutcome.index, taskOutcome);
      inFlight.delete(promise);
      settleSignal?.();
      settleSignal = null;
    });
    inFlight.add(promise);
    launched += 1;
  };

  const waitSettlement = (): Promise<void> =>
    new Promise((resolve) => {
      settleSignal = resolve;
    });

  const drainContiguous = async (): Promise<void> => {
    while (settled.has(nextToPersist)) {
      const ready = settled.get(nextToPersist)!;
      settled.delete(nextToPersist);
      if (ready.kind === 'stop') {
        terminal = { status: ready.status, error: ready.error };
        return;
      }
      persistedCount += 1;
      await applyPersist(persistedCount, ready);
      nextToPersist += 1;
    }
  };

  while (true) {
    await drainContiguous();
    if (terminal || abort()) {
      if (!terminal) {
        terminal = { status: 'canceled', error: null };
      }
      break;
    }
    while (launched < residual.length && inFlight.size < concurrency) {
      launch(launched);
    }
    if (inFlight.size === 0) {
      break;
    }
    await waitSettlement();
  }

  if (terminal) {
    while (inFlight.size > 0) {
      await waitSettlement();
      await drainContiguous();
    }
    const stragglers = [...settled.values()]
      .filter((taskOutcome): taskOutcome is Extract<DecideTaskOutcome, { kind: 'persist' }> => taskOutcome.kind === 'persist')
      .sort((a, b) => a.index - b.index);
    for (const straggler of stragglers) {
      persistedCount += 1;
      await applyPersist(persistedCount, straggler);
    }
    const pending = residual.length - persistedCount;
    totals.pending = pending;
    actualCalls = spent;
    if (terminal.status === 'paused' && terminal.error?.code === 'budget') {
      return outcome(usage, 'paused', totals, items, actualCalls, { code: 'budget', detail: { message: 'model-call budget reached', used: pending, limit: maxModelCalls } }, estimate.captured);
    }
    return outcome(usage, terminal.status, totals, items, actualCalls, terminal.error, estimate.captured);
  }

  actualCalls = spent;
  totals.pending = 0;
  return outcome(usage, 'done', totals, items, actualCalls, null, estimate.captured);
}

function buildAskInput(meta: { path: string; name: string; ext: string; size: number; ageDays: number }, excerpt: string | null, config: Record<string, unknown>): string {
  const facts = [
    `path: ${meta.path}`,
    `name: ${meta.name}`,
    `extension: ${meta.ext || '(none)'}`,
    `size bytes: ${meta.size}`,
    `age days: ${meta.ageDays.toFixed(1)}`,
  ].join('\n');
  const guidelines = typeof config.guidelines === 'string' ? config.guidelines.trim().slice(0, 500) : '';
  const withGuidelines = guidelines ? `${facts}\nuser guidelines:\n${guidelines}` : facts;
  return excerpt === null ? withGuidelines : `${withGuidelines}\ncontent (capped excerpt):\n${excerpt}`;
}

function outcome(
  usage: RunnerUsage,
  status: RunnerStatus,
  totals: MiniAppRunTotals,
  items: RunnerDecidedItem[],
  actualCalls: number,
  error: PackError | null,
  estimateCalls: number
): RunnerOutcome {
  return { status, totals, estimateCalls, actualCalls, usage, error, items };
}
