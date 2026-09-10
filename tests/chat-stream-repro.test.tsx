// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useMemo, useRef } from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useChatStream } from '@neuronection/assistant-ui/chat-core';
import { createIpcTransport } from '@renderer/chat-react/ipcTransport';
import type { TurnEvent } from '@shared/turns';

const CONV = 'conv-1';

function makeEvent(partial: Partial<TurnEvent> & { phase: TurnEvent['phase'] }): TurnEvent {
  return {
    tempMessageId: 'turn_1',
    conversationId: CONV,
    seq: Math.floor(Math.random() * 1e6),
    ...partial,
  } as TurnEvent;
}

function Harness({ onFinish }: { onFinish: (conversationId: string) => void }) {
  const finishedRef = useRef(onFinish);
  finishedRef.current = onFinish;

  const transport = useMemo(
    () =>
      createIpcTransport({
        onStartTurn: () => ({ conversationId: CONV, content: 'hi' }),
        onFinishTurn: async (outcome) => finishedRef.current(outcome.conversationId),
        onTurnEvent: () => {},
      }),
    []
  );
  const live = useChatStream({ transport, flushMs: 33, timeoutMs: 120000 });
  return (
    <div>
      <div data-testid="status">{live.live?.status ?? 'none'}</div>
      <div data-testid="text">{live.live?.text ?? ''}</div>
      <button data-testid="send" onClick={() => void live.send('hi')}>
        send
      </button>
    </div>
  );
}

describe('chat streaming pipeline repro', () => {
  afterEach(cleanup);

  it('streams deltas into live text and fires finish', async () => {
    vi.useFakeTimers();
    let handler: ((event: TurnEvent) => void) | null = null;
    window.electronAPI = {
      startTurn: vi.fn(async () => {
        return { tempMessageId: 'turn_1' };
      }),
      cancelTurn: vi.fn(async () => true),
      onTurnEvent: vi.fn((cb: (event: TurnEvent) => void) => {
        handler = cb;
        return () => {
          handler = null;
        };
      }),
    } as unknown as typeof window.electronAPI;

    const finishes: string[] = [];
    render(<Harness onFinish={(id) => finishes.push(id)} />);

    act(() => {
      screen.getByTestId('send').click();
    });

    expect(screen.getByTestId('status').textContent).toBe('pending');

    const pump = (event: TurnEvent): void => {
      act(() => {
        handler?.(event);
      });
    };

    pump(makeEvent({ phase: 'queued', seq: 1 }));
    pump(makeEvent({ phase: 'thinking', seq: 2, step: { id: 'think', phase: 'thinking', label: 'Thinking', startedAt: Date.now() } }));
    for (let i = 0; i < 5; i++) {
      pump(makeEvent({ phase: 'streaming', seq: 3 + i, delta: `chunk${i} ` }));
    }
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByTestId('status').textContent).toBe('streaming');
    expect(screen.getByTestId('text').textContent).toContain('chunk4');

    pump(makeEvent({ phase: 'finished', seq: 99, steps: [], durationMs: 10 }));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(screen.getByTestId('status').textContent).toBe('done');
    expect(finishes).toEqual([CONV]);
    vi.useRealTimers();
  });
});
