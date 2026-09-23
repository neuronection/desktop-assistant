// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TurnEvent } from '@shared/types';
import type { LiveEvent, LiveSnapshot } from '@shared/live';

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
});

afterEach(cleanup);

const IDLE: LiveSnapshot = {
  state: 'idle',
  capture: 'closed',
  downgraded: false,
  turns: 0,
  candidate: false,
  session: 0,
};

function mockApi(): { emit: (event: LiveEvent) => void } {
  const liveListeners: Array<(event: LiveEvent) => void> = [];
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((_callback: (event: TurnEvent) => void) => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(async () => {}),
    openDesktop: vi.fn(async () => {}),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
    getLiveState: vi.fn(async () => IDLE),
    onLiveEvent: vi.fn((callback: (event: LiveEvent) => void) => {
      liveListeners.push(callback);
      return () => {
        const index = liveListeners.indexOf(callback);
        if (index >= 0) liveListeners.splice(index, 1);
      };
    }),
  } as unknown as typeof window.electronAPI;
  return {
    emit: (event: LiveEvent) => liveListeners.forEach((listener) => listener(event)),
  };
}

function snapshot(patch: Partial<LiveSnapshot>): LiveSnapshot {
  return { ...IDLE, session: 1, ...patch };
}

describe('live conversation mode in the desktop window (plan 25)', () => {
  it('shows the Live toggle and reflects pushed session state', async () => {
    const { emit } = mockApi();
    render(<StrictMode><DesktopApp /></StrictMode>);

    const button = await screen.findByLabelText('Start live conversation');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    emit({ type: 'state', snapshot: snapshot({ state: 'speaking', capture: 'open', turns: 1 }) });
    await waitFor(() => expect(screen.getByText('Speaking')).toBeTruthy());
    expect(screen.getByLabelText('End live conversation').getAttribute('aria-pressed')).toBe('true');

    emit({ type: 'state', snapshot: snapshot({ state: 'listening', capture: 'open', turns: 1 }) });
    await waitFor(() => expect(screen.getByText('Listening')).toBeTruthy());

    emit({ type: 'ended', reason: 'user', turns: 1 });
    emit({ type: 'state', snapshot: IDLE });
    await waitFor(() => expect(screen.queryByText('Listening')).toBeNull());
    expect(screen.getByLabelText('Start live conversation').getAttribute('aria-pressed')).toBe('false');
  });

  it('consumes duck and notice events without disrupting the session', async () => {
    const { emit } = mockApi();
    render(<StrictMode><DesktopApp /></StrictMode>);
    await screen.findByLabelText('Start live conversation');

    emit({ type: 'state', snapshot: snapshot({ state: 'speaking', capture: 'open' }) });
    await waitFor(() => expect(screen.getByText('Speaking')).toBeTruthy());

    emit({ type: 'duck', on: true });
    emit({ type: 'intent', intent: 'ignore', engine: 'echo' });
    emit({ type: 'duck', on: false });
    emit({ type: 'notice', level: 'info', code: 'idle_timeout' });

    expect(screen.getByText('Speaking')).toBeTruthy();
  });
});
