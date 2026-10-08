import { extname } from 'path';
import { createHash } from 'node:crypto';
import type { ValidatedPack } from '@shared/app-pack';
import { PACK_LIMITS } from '@shared/app-pack';
import type { AssessmentPackManifest } from '@shared/app-pack';
import type { PackError, PackVerdict } from '@shared/app-pack';
import type { PackFs } from '../capabilities/fs';
import type { PackAskResult } from '../capabilities/decide';
import { classifyItem, composeVerdict, type SignalContext } from './evaluate';
import type { MiniAppRunItemRow, MiniAppRunTotals } from '../run/store';

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
  decide: { ask(input: string, questions: AssessmentPackManifest['run']['decide'] extends undefined ? never : NonNullable<AssessmentPackManifest['run']['decide']>['questions']): Promise<PackAskResult> } | null;
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

function hashPart(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function fileNameOf(relative: string): string {
  const segments = relative.split('/');
  return segments[segments.length - 1] ?? relative;
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
  await deps.fs.scan(
    {
      includeHidden: run.scan.includeHidden ?? false,
      excludeGlobs: run.scan.excludeGlobs ?? [],
      fileCap: run.scan.fileCap ?? PACK_LIMITS.scanFileCapDefault,
      maxDepth: run.scan.maxDepth ?? PACK_LIMITS.scanDepthDefault,
    },
    { files: 0, truncated: false, deadline: deps.now() + 30_000 },
    async (entry) => {
      scanned.push({ relative: entry.relative, size: entry.size, mtimeMs: entry.mtimeMs });
    }
  );
  totals.scanned = scanned.length;
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
    const override = deps.feedback?.get(entry.relative);
    const fingerprint = hashPart(deps.rootPath, entry.relative, String(entry.size), String(entry.mtimeMs));
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

  for (let index = 0; index < residual.length; index += 1) {
    if (abort()) {
      totals.pending = residual.length - index;
      return outcome(usage, 'canceled', totals, items, actualCalls, null, estimate.captured);
    }
    const entry = residual[index];
    let fingerprint = hashPart(deps.rootPath, entry.relative, String(entry.size), String(entry.mtimeMs));
    let excerpt: string | null = null;
    const readContext = run.decide?.readContext === true && manifest.privacy.sendsContent;
    if (readContext) {
      const cap = manifest.privacy.contentCapBytes ?? PACK_LIMITS.contentExcerptMaxBytes;
      const read = await deps.fs.readExcerpt(entry.relative, cap);
      if (read.ok) {
        excerpt = read.value.buffer.toString('utf8');
        fingerprint = hashPart(fingerprint, read.value.buffer.toString('hex'));
      } else {
        totals.ask += 1;
        totals.pending = residual.length - index - 1;
        await persisted({
          relPath: entry.relative,
          fingerprint,
          verdict: 'ask',
          confidence: null,
          decidedBy: 'fs-error',
          evidence: { error: read.error },
        });
        continue;
      }
    }

    const cached = await deps.items.findCachedVerdict({ ...deps.key, fingerprint });
    if (cached) {
      totals.keep += cached.verdict === 'keep' ? 1 : 0;
      totals.ask += cached.verdict === 'ask' ? 1 : 0;
      totals.candidate += cached.verdict === 'candidate' ? 1 : 0;
      totals.cacheHits += 1;
      await persisted({
        relPath: entry.relative,
        fingerprint,
        verdict: cached.verdict,
        confidence: cached.confidence,
        decidedBy: 'cache',
        evidence: cached.evidence,
      });
      deps.emit({ type: 'progress', phase: 'decide', done: index + 1, total: residual.length });
      continue;
    }

    if (actualCalls >= maxModelCalls) {
      totals.pending = residual.length - index;
      return outcome(usage, 'paused', totals, items, actualCalls, {
        code: 'budget',
        detail: { pending: totals.pending, maxModelCalls },
      }, estimate.captured);
    }

    const input = buildAskInput(entry.context.meta, excerpt);
    const result = await deps.decide.ask(input, run.decide?.questions ?? []);
    if (!result.ok) {
      if (result.error.code === 'canceled' || abort()) {
        totals.pending = residual.length - index;
        return outcome(usage, 'canceled', totals, items, actualCalls, result.error, estimate.captured);
      }
      if (result.error.code === 'rate-limited') {
        totals.pending = residual.length - index;
        return outcome(usage, 'paused', totals, items, actualCalls, result.error, estimate.captured);
      }
      totals.pending = residual.length - index;
      return outcome(usage, 'failed', totals, items, actualCalls, result.error, estimate.captured);
    }
    actualCalls += 1;
    if (result.value.usage) {
      usage.inputTokens += result.value.usage.inputTokens;
      usage.outputTokens += result.value.usage.outputTokens;
    }
    entry.context.answers = result.value.answers;
    const verdict = composeVerdict(run.compose, entry.context);
    totals.keep += verdict === 'keep' ? 1 : 0;
    totals.ask += verdict === 'ask' ? 1 : 0;
    totals.candidate += verdict === 'candidate' ? 1 : 0;
    totals.modelDecided += 1;
    await persisted({
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
    });
    deps.emit({ type: 'progress', phase: 'decide', done: index + 1, total: residual.length });
  }

  totals.pending = 0;
  return outcome(usage, 'done', totals, items, actualCalls, null, estimate.captured);
}

function buildAskInput(meta: { path: string; name: string; ext: string; size: number; ageDays: number }, excerpt: string | null): string {
  const facts = [
    `path: ${meta.path}`,
    `name: ${meta.name}`,
    `extension: ${meta.ext || '(none)'}`,
    `size bytes: ${meta.size}`,
    `age days: ${meta.ageDays.toFixed(1)}`,
  ].join('\n');
  return excerpt === null ? facts : `${facts}\ncontent (capped excerpt):\n${excerpt}`;
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
