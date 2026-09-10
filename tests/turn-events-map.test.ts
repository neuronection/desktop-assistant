import { describe, it, expect } from 'vitest';
import { turnEventToChatStreamEvents } from '@renderer/chat-react/turnEventsMap';
import type { TurnEvent, TurnTraceStep } from '@shared/turns';

const base = {
  tempMessageId: 'turn_1',
  conversationId: 'conv_1',
};

const thinkingStep: TurnTraceStep = {
  id: 'think_1',
  phase: 'thinking',
  label: 'Thinking',
  startedAt: 1000,
};

describe('turnEventToChatStreamEvents', () => {
  it('maps queued to flow_started', () => {
    expect(turnEventToChatStreamEvents({ ...base, seq: 1, phase: 'queued' })).toEqual([
      { event: 'flow_started', flow: 'chat' },
    ]);
  });

  it('maps a thinking step to node_started', () => {
    expect(
      turnEventToChatStreamEvents({ ...base, seq: 2, phase: 'thinking', step: thinkingStep })
    ).toEqual([{ event: 'node_started', node: 'think_1', label: 'Thinking' }]);
  });

  it('maps the first streaming event to node_finished then delta', () => {
    const closed = { ...thinkingStep, endedAt: 2500 };
    expect(
      turnEventToChatStreamEvents({ ...base, seq: 3, phase: 'streaming', delta: 'He', step: closed })
    ).toEqual([
      { event: 'node_finished', node: 'think_1', label: 'Thinking', outcome: 'done' },
      { event: 'delta', text: 'He' },
    ]);
  });

  it('maps plain streaming events to a single delta', () => {
    expect(turnEventToChatStreamEvents({ ...base, seq: 4, phase: 'streaming', delta: 'llo' })).toEqual([
      { event: 'delta', text: 'llo' },
    ]);
  });

  it('maps tool steps to tool_call events with status', () => {
    const running: TurnTraceStep = {
      id: 'tool_1',
      phase: 'tool_call',
      label: 'Searching the web',
      toolName: 'web_search',
      startedAt: 1000,
      summary: 'query: cats',
    };
    expect(turnEventToChatStreamEvents({ ...base, seq: 5, phase: 'tool_call', step: running })).toEqual([
      {
        event: 'tool_call',
        id: 'tool_1',
        name: 'web_search',
        title: 'Searching the web',
        status: 'running',
        args: 'query: cats',
        result: undefined,
        durationMs: undefined,
      },
    ]);

    const done: TurnTraceStep = {
      ...running,
      phase: 'tool_result',
      startedAt: 1000,
      endedAt: 1800,
      detail: '3 results',
    };
    expect(turnEventToChatStreamEvents({ ...base, seq: 6, phase: 'tool_result', step: done })[0]).toMatchObject({
      event: 'tool_call',
      id: 'tool_1',
      status: 'done',
      result: '3 results',
      durationMs: 800,
    });
  });

  it('maps node payload events onto node_started/node_finished without app-only fields', () => {
    expect(
      turnEventToChatStreamEvents({
        ...base,
        seq: 11,
        phase: 'thinking',
        node: { node: 'model_request', label: 'Thinking', resumed: false },
      })
    ).toEqual([{ event: 'node_started', node: 'model_request', label: 'Thinking' }]);

    expect(
      turnEventToChatStreamEvents({
        ...base,
        seq: 12,
        phase: 'thinking',
        node: {
          node: 'model_request',
          label: 'Thinking',
          outcome: 'interrupted',
          durationMs: 12,
          resumed: true,
        },
      })
    ).toEqual([{ event: 'node_finished', node: 'model_request', label: 'Thinking', outcome: 'interrupted' }]);
  });

  it('maps terminal phases', () => {
    expect(turnEventToChatStreamEvents({ ...base, seq: 7, phase: 'finished', steps: [] })).toEqual([
      { event: 'flow_finished' },
    ]);
    expect(
      turnEventToChatStreamEvents({ ...base, seq: 8, phase: 'failed', error: 'boom' })
    ).toEqual([{ event: 'flow_failed', code: 'provider_error', message: 'boom', retryable: false }]);
    expect(turnEventToChatStreamEvents({ ...base, seq: 9, phase: 'cancelled' })[0]).toMatchObject({
      event: 'flow_failed',
      code: 'cancelled',
    });
  });

  it('drops step events without a step and streaming events without delta or step', () => {
    expect(turnEventToChatStreamEvents({ ...base, seq: 1, phase: 'thinking' })).toEqual([]);
    expect(turnEventToChatStreamEvents({ ...base, seq: 2, phase: 'streaming' })).toEqual([]);
  });

  it('maps the interrupt phase to a paused approval node', () => {
    expect(
      turnEventToChatStreamEvents({ ...base, seq: 10, phase: 'interrupt', interrupt: { requests: [], deadline: 1 } })
    ).toEqual([{ event: 'node_started', node: 'approval', label: 'Approval needed' }]);
  });
});
