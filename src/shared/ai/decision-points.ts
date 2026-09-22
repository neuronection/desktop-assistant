import type { DecisionCapability } from './decisions';

/**
 * Decision points (plan 24 D5): the orchestration contract that keeps
 * "when/what happens" out of the engines. A point requests a capability,
 * declares its phase and mode, and produces a verdict; the runner fans
 * points out in parallel, times each one out, honours cancellation, and
 * fails open per point.
 */

export type DecisionPhase = 'pre-input' | 'pre-model' | 'post-response';
export type DecisionMode = 'blocking' | 'advisory' | 'fire-and-forget';

/** Disjoint action domains — two points claiming the same domain is a config error. */
export type DecisionDomain = 'dispatch' | 'route' | 'gate' | 'speak' | 'notify' | 'tag';

export interface DecisionPointDescriptor {
  id: string;
  capability: DecisionCapability;
  phase: DecisionPhase;
  mode: DecisionMode;
  domains: readonly DecisionDomain[];
}

export interface DecisionPointRun<Verdict> {
  descriptor: DecisionPointDescriptor;
  run(signal: AbortSignal): Promise<Verdict>;
}

export type DecisionPointStatus = 'ok' | 'timeout' | 'error' | 'skipped';

export interface DecisionPointOutcome<Verdict> {
  descriptor: DecisionPointDescriptor;
  status: DecisionPointStatus;
  verdict?: Verdict;
  error?: string;
}

export interface DecisionBatchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecisionBatchResult<Verdict> {
  outcomes: DecisionPointOutcome<Verdict>[];
}

export const DECISION_POINT_TIMEOUT_MS = 4_000;

/**
 * Domains produced by more than one descriptor. Callers surface these as
 * a config error (settings) rather than reconciling at runtime.
 */
export function decisionDomainConflicts(
  descriptors: readonly DecisionPointDescriptor[]
): DecisionDomain[] {
  const seen = new Set<DecisionDomain>();
  const conflicts = new Set<DecisionDomain>();
  for (const descriptor of descriptors) {
    for (const domain of descriptor.domains) {
      if (seen.has(domain)) {
        conflicts.add(domain);
      }
      seen.add(domain);
    }
  }
  return [...conflicts];
}

/** Blocking points that produced a verdict — the ones allowed to shape the turn. */
export function blockingOutcomes<Verdict>(
  result: DecisionBatchResult<Verdict>
): DecisionPointOutcome<Verdict>[] {
  return result.outcomes.filter((outcome) => outcome.descriptor.mode === 'blocking' && outcome.status === 'ok');
}

async function runOne<Verdict>(
  run: DecisionPointRun<Verdict>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<DecisionPointOutcome<Verdict>> {
  if (signal?.aborted) {
    return { descriptor: run.descriptor, status: 'skipped' };
  }
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verdict = await Promise.race([
      run.run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('decision point timed out'));
        }, timeoutMs);
      }),
    ]);
    return { descriptor: run.descriptor, status: 'ok', verdict };
  } catch (error) {
    const status: DecisionPointStatus = timedOut ? 'timeout' : signal?.aborted ? 'skipped' : 'error';
    return {
      descriptor: run.descriptor,
      status,
      error: String((error as Error)?.message ?? error).slice(0, 300),
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Fan points out in parallel; each fails open to its own outcome. */
export async function runDecisionBatch<Verdict>(
  runs: readonly DecisionPointRun<Verdict>[],
  options: DecisionBatchOptions = {}
): Promise<DecisionBatchResult<Verdict>> {
  const timeoutMs = options.timeoutMs ?? DECISION_POINT_TIMEOUT_MS;
  const outcomes = await Promise.all(runs.map((run) => runOne(run, timeoutMs, options.signal)));
  return { outcomes };
}
