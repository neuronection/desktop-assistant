import { describe, expect, it } from 'vitest';
import { PackRunBridge } from '@main/apps/capabilities/run';

function bridge(): PackRunBridge {
  return new PackRunBridge({ newId: () => `run-${Math.random()}`, now: () => 42_000 });
}

describe('PackRunBridge — start/progress/cancel only', () => {
  it('starts a run scoped to its pack, tracks progress and exposes an abort signal', () => {
    const runs = bridge();
    const started = runs.start('pack-a', 'run-1', 'assessment');
    expect(started.ok).toBe(true);
    expect(runs.get('pack-a', 'run-1')?.status).toBe('running');
    expect(runs.progress('pack-a', 'run-1', 3, 10)).toBe(true);
    expect(runs.get('pack-a', 'run-1')?.progress).toEqual({ done: 3, total: 10 });
    expect(runs.signal('pack-a', 'run-1')?.aborted).toBe(false);
  });

  it('never lets one pack address another pack’s run', () => {
    const runs = bridge();
    void runs.start('pack-a', 'run-1', 'assessment');
    expect(runs.get('pack-b', 'run-1')).toBeNull();
    expect(runs.progress('pack-b', 'run-1', 1, 2)).toBe(false);
    const canceled = runs.cancel('pack-b', 'run-1');
    expect(canceled.ok).toBe(false);
    if (!canceled.ok) {
      expect(canceled.error.code).toBe('not-found');
    }
  });

  it('cancel aborts the signal and settles the run; finished runs stop existing', () => {
    const runs = bridge();
    void runs.start('pack-a', 'run-1', 'assessment');
    const canceled = runs.cancel('pack-a', 'run-1');
    expect(canceled.ok).toBe(true);
    expect(runs.signal('pack-a', 'run-1')?.aborted).toBe(true);
    expect(runs.get('pack-a', 'run-1')?.status).toBe('canceled');

    void runs.start('pack-a', 'run-2', 'assessment');
    expect(runs.finish('pack-a', 'run-2', 'done')).toBe(true);
    expect(runs.get('pack-a', 'run-2')).toBeNull();
  });

  it('paused runs stay resumable with a fresh signal; unknown ids are typed not-found', () => {
    const runs = bridge();
    void runs.start('pack-a', 'run-1', 'assessment');
    runs.signal('pack-a', 'run-1')?.addEventListener('abort', () => undefined);
    expect(runs.finish('pack-a', 'run-1', 'paused')).toBe(true);
    expect(runs.get('pack-a', 'run-1')?.status).toBe('paused');
    const resumed = runs.resume('pack-a', 'run-1');
    expect(resumed.ok).toBe(true);
    expect(runs.get('pack-a', 'run-1')?.status).toBe('running');
    const missing = runs.resume('pack-a', 'run-nope');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('not-found');
    }
  });

  it('refuses duplicate run ids (invalid)', () => {
    const runs = bridge();
    void runs.start('pack-a', 'run-1', 'assessment');
    const dup = runs.start('pack-a', 'run-1', 'again');
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe('invalid');
    }
  });
});
