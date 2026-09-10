import { describe, it, expect } from 'vitest';
import { createTurnTraceStore } from '@renderer/chat-react/turnTraceStore';
import type { TurnEvent, TurnTraceStep } from '@shared/turns';

const turn = { tempMessageId: 'turn_1', conversationId: 'conv_1' };

const thinking: TurnTraceStep = {
  id: 'think_1',
  phase: 'thinking',
  label: 'Thinking',
  startedAt: 1000,
};

describe('createTurnTraceStore', () => {
  it('resets state on queued and accumulates deltas', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 2, phase: 'streaming', delta: 'old' });
    expect(store.getSnapshot().text).toBe('');

    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({ ...turn, seq: 2, phase: 'thinking', step: thinking });
    store.handleEvent({ ...turn, seq: 3, phase: 'streaming', delta: 'He', step: { ...thinking, endedAt: 2000 } });
    store.handleEvent({ ...turn, seq: 4, phase: 'streaming', delta: 'llo' });

    const snapshot = store.getSnapshot();
    expect(snapshot.turnId).toBe('turn_1');
    expect(snapshot.text).toBe('Hello');
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.steps[0]).toMatchObject({ id: 'think_1', endedAt: 2000 });
  });

  it('merges a resumed thinking replay into the prior step instead of appending', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({
      ...turn,
      seq: 2,
      phase: 'thinking',
      step: { id: 'n1', phase: 'thinking', label: 'Thinking', startedAt: 1000, node: 'model_request' },
    });
    store.handleEvent({
      ...turn,
      seq: 3,
      phase: 'thinking',
      step: {
        id: 'n2',
        phase: 'thinking',
        label: 'Thinking',
        startedAt: 2000,
        endedAt: 2005,
        node: 'HumanInTheLoopMiddleware.after_model',
        resumed: true,
      },
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.steps).toHaveLength(1);
    expect(snapshot.steps[0]).toMatchObject({ id: 'n1', node: 'model_request', resumed: true });
  });

  it('accumulates node-stamped steps alongside tool steps', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({
      ...turn,
      seq: 2,
      phase: 'thinking',
      step: { id: 'node_model_1', phase: 'thinking', label: 'Thinking', startedAt: 1000, node: 'model_request' },
    });
    store.handleEvent({
      ...turn,
      seq: 3,
      phase: 'tool_result',
      step: {
        id: 'tool_c1',
        phase: 'tool_result',
        label: 'screen_capture',
        toolName: 'screen_capture',
        startedAt: 1100,
        endedAt: 1200,
        status: 'ok',
        node: 'tools',
      },
    });

    expect(store.getSnapshot().steps.map((step) => step.node)).toEqual(['model_request', 'tools']);
  });

  it('ignores events from a different turn', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({
      tempMessageId: 'turn_2',
      conversationId: 'conv_2',
      seq: 1,
      phase: 'streaming',
      delta: 'other',
    });
    expect(store.getSnapshot().text).toBe('');
    expect(store.getSnapshot().phase).toBe('queued');
  });

  it('adopts the authoritative steps payload on terminal events', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({ ...turn, seq: 2, phase: 'thinking', step: thinking });
    store.handleEvent({
      ...turn,
      seq: 3,
      phase: 'finished',
      steps: [{ ...thinking, endedAt: 3000 }],
      model: 'test-model',
      durationMs: 2000,
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe('finished');
    expect(snapshot.endedAt).not.toBeNull();
    expect(snapshot.steps[0]).toMatchObject({ endedAt: 3000 });
  });

  it('captures errors and notifies subscribers', () => {
    const store = createTurnTraceStore();
    const seen: string[] = [];
    store.subscribe((snapshot) => seen.push(snapshot.phase ?? 'null'));

    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({ ...turn, seq: 2, phase: 'failed', error: 'boom' });

    expect(store.getSnapshot().error).toBe('boom');
    expect(seen).toEqual(['queued', 'failed']);
  });

  it('reset clears the snapshot', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.reset();
    expect(store.getSnapshot().turnId).toBeNull();
    expect(store.getSnapshot().steps).toEqual([]);
  });

  it('stores the interrupt payload and clears it optimistically and on the next event', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.handleEvent({
      ...turn,
      seq: 2,
      phase: 'interrupt',
      interrupt: { requests: [], deadline: 12345 },
    });
    expect(store.getSnapshot().interrupt).toEqual({ requests: [], deadline: 12345 });

    store.clearInterrupt();
    expect(store.getSnapshot().interrupt).toBeNull();

    store.handleEvent({
      ...turn,
      seq: 3,
      phase: 'interrupt',
      interrupt: { requests: [], deadline: 99999 },
    });
    store.handleEvent({ ...turn, seq: 4, phase: 'streaming', delta: 'ok' });
    expect(store.getSnapshot().interrupt).toBeNull();
    expect(store.getSnapshot().text).toBe('ok');
  });

  it('clearInterrupt is a no-op without a pending interrupt', () => {
    const store = createTurnTraceStore();
    store.handleEvent({ ...turn, seq: 1, phase: 'queued' });
    store.clearInterrupt();
    expect(store.getSnapshot().interrupt).toBeNull();
  });
});
