// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createIpcTransport } from '@renderer/chat-react/ipcTransport';
import type { TurnEvent } from '@shared/turns';

function turnEvent(phase: TurnEvent['phase'], extra: Partial<TurnEvent> = {}): TurnEvent {
  return { tempMessageId: 'turn_1', conversationId: 'conv-1', seq: 1, phase, ...extra } as TurnEvent;
}

function installBridge(): { listeners: ((event: TurnEvent) => void)[] } {
  const listeners: ((event: TurnEvent) => void)[] = [];
  window.electronAPI = {
    onTurnEvent: vi.fn((cb: (event: TurnEvent) => void) => {
      listeners.push(cb);
      return () => {};
    }),
    startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
    cancelTurn: vi.fn(async () => true),
  } as unknown as typeof window.electronAPI;
  return { listeners };
}

function transport() {
  return createIpcTransport({
    onStartTurn: () => null,
    onFinishTurn: async () => {},
    onTurnEvent: () => {},
  });
}

describe('turn-event bridge lifecycle (plan 42 FIX 6)', () => {
  it('registers exactly ONE Electron listener across re-subscribes and swaps the handler', () => {
    const { listeners } = installBridge();
    const bus = transport();
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe({ onEvent: first });
    bus.subscribe({ onEvent: second });

    // Idempotent: a re-subscribe swaps the handler, it never tears the
    // listener down and re-adds it (the delta-loss gap).
    expect(window.electronAPI.onTurnEvent).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(1);

    listeners[0]!(turnEvent('streaming', { delta: 'answer' }));
    expect(second).toHaveBeenCalledWith({ event: 'delta', text: 'answer' });
    expect(first).not.toHaveBeenCalled();
  });

  it('a stale unsubscribe cannot kill the live subscription', () => {
    const { listeners } = installBridge();
    const bus = transport();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = bus.subscribe({ onEvent: first });
    bus.subscribe({ onEvent: second });

    unsubscribeFirst();
    listeners[0]!(turnEvent('streaming', { delta: 'still here' }));
    expect(second).toHaveBeenCalledWith({ event: 'delta', text: 'still here' });
  });

  it('unsubscribes the listener when the current subscriber detaches', () => {
    const { listeners } = installBridge();
    const bus = transport();
    const unsubscribe = bus.subscribe({ onEvent: vi.fn() });
    unsubscribe();
    // Detaching the current subscriber releases the listener; a later
    // subscribe registers a fresh one.
    bus.subscribe({ onEvent: vi.fn() });
    expect(listeners).toHaveLength(2);
  });
});
