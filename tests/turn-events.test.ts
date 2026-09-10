import { describe, it, expect } from 'vitest';
import { TurnEventLog } from '@main/turns/turnEvents';
import type { TurnEvent } from '@shared/turns';

describe('TurnEventLog', () => {
  it('emits envelopes with incrementing seq and turn identity', () => {
    const events: TurnEvent[] = [];
    const log = new TurnEventLog('turn_1', 'conv_1', (event) => events.push(event));

    log.phase('queued');
    log.phase('streaming', { delta: 'Hi' });

    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events[0]).toMatchObject({
      tempMessageId: 'turn_1',
      conversationId: 'conv_1',
      phase: 'queued',
    });
    expect(events[1]).toMatchObject({ phase: 'streaming', delta: 'Hi' });
  });

  it('tracks step lifecycle and returns closed snapshots', () => {
    const events: TurnEvent[] = [];
    const log = new TurnEventLog('turn_1', 'conv_1', (event) => events.push(event));

    const thinking = log.beginStep({ id: 'think_1', phase: 'thinking', label: 'Thinking' }, 1000);
    expect(thinking.startedAt).toBe(1000);
    expect(thinking.endedAt).toBeUndefined();

    const closed = log.endStep('think_1', 2500);
    expect(closed).toMatchObject({ id: 'think_1', startedAt: 1000, endedAt: 2500 });

    const all = log.allSteps();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ endedAt: 2500 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ phase: 'thinking', step: { id: 'think_1' } });
    expect(events[0].step?.endedAt).toBeUndefined();
  });

  it('returns null when ending an unknown step', () => {
    const log = new TurnEventLog('turn_1', 'conv_1', () => {});
    expect(log.endStep('missing')).toBeNull();
  });
});
