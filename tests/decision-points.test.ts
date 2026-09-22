import { describe, it, expect } from 'vitest';
import {
  blockingOutcomes,
  decisionDomainConflicts,
  runDecisionBatch,
  type DecisionPointDescriptor,
  type DecisionPointRun,
} from '@shared/ai/decision-points';

function descriptor(overrides: Partial<DecisionPointDescriptor> = {}): DecisionPointDescriptor {
  return {
    id: 'point',
    capability: 'tool-dispatch',
    phase: 'pre-model',
    mode: 'blocking',
    domains: ['dispatch'],
    ...overrides,
  };
}

describe('runDecisionBatch (plan 24 S3)', () => {
  it('runs points in parallel and preserves order', async () => {
    const runs: DecisionPointRun<string>[] = [
      { descriptor: descriptor({ id: 'a' }), run: async () => 'first' },
      { descriptor: descriptor({ id: 'b', domains: ['route'] }), run: async () => 'second' },
    ];
    const result = await runDecisionBatch(runs);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['ok', 'ok']);
    expect(result.outcomes.map((outcome) => outcome.verdict)).toEqual(['first', 'second']);
  });

  it('fails a point open on error without affecting the others', async () => {
    const runs: DecisionPointRun<string>[] = [
      {
        descriptor: descriptor({ id: 'boom' }),
        run: async () => {
          throw new Error('engine down');
        },
      },
      { descriptor: descriptor({ id: 'ok', domains: ['route'] }), run: async () => 'fine' },
    ];
    const result = await runDecisionBatch(runs);
    expect(result.outcomes[0]).toMatchObject({ status: 'error', error: 'engine down' });
    expect(result.outcomes[1]).toMatchObject({ status: 'ok', verdict: 'fine' });
  });

  it('times a point out and aborts its signal', async () => {
    let aborted = false;
    const runs: DecisionPointRun<string>[] = [
      {
        descriptor: descriptor({ id: 'slow' }),
        run: (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      },
    ];
    const result = await runDecisionBatch(runs, { timeoutMs: 20 });
    expect(result.outcomes[0]?.status).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it('skips points when the parent signal is already aborted', async () => {
    let called = false;
    const controller = new AbortController();
    controller.abort();
    const runs: DecisionPointRun<string>[] = [
      {
        descriptor: descriptor(),
        run: async () => {
          called = true;
          return 'x';
        },
      },
    ];
    const result = await runDecisionBatch(runs, { signal: controller.signal });
    expect(result.outcomes[0]?.status).toBe('skipped');
    expect(called).toBe(false);
  });

  it('marks a point skipped when the parent signal aborts mid-flight', async () => {
    const controller = new AbortController();
    const runs: DecisionPointRun<string>[] = [
      {
        descriptor: descriptor(),
        run: (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      },
    ];
    const pending = runDecisionBatch(runs, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    const result = await pending;
    expect(result.outcomes[0]?.status).toBe('skipped');
  });
});

describe('decision domain composition (plan 24 D5)', () => {
  it('reports domains claimed by more than one point', () => {
    const conflicts = decisionDomainConflicts([
      descriptor({ id: 'a', domains: ['dispatch', 'route'] }),
      descriptor({ id: 'b', domains: ['route', 'speak'] }),
    ]);
    expect(conflicts).toEqual(['route']);
  });

  it('returns only blocking, ok outcomes for turn shaping', async () => {
    const runs: DecisionPointRun<string>[] = [
      { descriptor: descriptor({ id: 'b', mode: 'blocking' }), run: async () => 'b' },
      { descriptor: descriptor({ id: 'a', mode: 'advisory', domains: ['speak'] }), run: async () => 'a' },
      {
        descriptor: descriptor({ id: 'f', mode: 'fire-and-forget', domains: ['notify'] }),
        run: async () => 'f',
      },
    ];
    const result = await runDecisionBatch(runs);
    expect(blockingOutcomes(result).map((outcome) => outcome.descriptor.id)).toEqual(['b']);
  });
});
