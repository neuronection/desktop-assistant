// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TurnEvent } from '@shared/turns';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

const ACTIVE_CONV = {
  id: 'conv-1',
  title: 'Test',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  isArchived: false,
};

function turnEvent(phase: TurnEvent['phase'], seq: number, extra: Partial<TurnEvent> = {}): TurnEvent {
  return { tempMessageId: 'turn_1', conversationId: 'conv-1', seq, phase, ...extra } as TurnEvent;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('ChatApp live streaming', () => {
  it('renders streaming deltas in the launcher response panel', async () => {
    let handler: ((event: TurnEvent) => void) | null = null;
    let registrations = 0;
    const config: AppConfig = { ...DEFAULT_CONFIG };
    window.electronAPI = {
      loadConfig: vi.fn(async () => config),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async (id: string) => (id === 'conv-1' ? { ...ACTIVE_CONV, messages: [] } : null)),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent: vi.fn((cb: (event: TurnEvent) => void) => {
        registrations += 1;
        handler = cb;
        return () => {
          handler = null;
        };
      }),
      startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
      cancelTurn: vi.fn(async () => true),
      resumeTurn: vi.fn(async () => true),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn(() => () => {}),
      onFocusInput: vi.fn(() => () => {}),
      getScreenSources: vi.fn(async () => []),
      setConversationMetadata: vi.fn(async () => {}),
    } as unknown as typeof window.electronAPI;

    render(<ChatApp onThemeChange={vi.fn()} />);
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await wait(30);

    // The turn-event listener must be registered exactly once and stay live:
    // a missing handler is a hard failure, never a silent `handler?.()` no-op.
    expect(registrations).toBe(1);
    const deliver = (event: TurnEvent): void => {
      expect(handler).not.toBeNull();
      act(() => {
        handler!(event);
      });
    };

    deliver(turnEvent('queued', 1));
    deliver(turnEvent('streaming', 2, { delta: 'partial ' }));
    // The library coalesces deltas on a 33 ms flush; wait for the render
    // instead of racing a fixed sleep (the FIX 6 flake).
    await waitFor(() => expect(document.body.textContent).toContain('partial'));
    deliver(turnEvent('streaming', 3, { delta: 'answer ' }));
    await waitFor(() => expect(document.body.textContent).toContain('partial answer'));

    deliver(turnEvent('finished', 4, { steps: [], durationMs: 5, model: 'm' }));
  });
});
