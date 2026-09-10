// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
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
    const config: AppConfig = { ...DEFAULT_CONFIG };
    window.electronAPI = {
      loadConfig: vi.fn(async () => config),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async (id: string) => (id === 'conv-1' ? { ...ACTIVE_CONV, messages: [] } : null)),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent: vi.fn((cb: (event: TurnEvent) => void) => {
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
    console.log('body before send:', JSON.stringify(document.body.textContent?.slice(0, 200)));
    fireEvent.change(textarea, { target: { value: 'hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await wait(30);

    const startTurn = window.electronAPI.startTurn as ReturnType<typeof vi.fn>;
    console.log('startTurn calls:', startTurn.mock.calls.length);
    console.log('body after send:', JSON.stringify(document.body.textContent?.slice(0, 300)));

    act(() => {
      handler?.(turnEvent('queued', 1));
    });
    act(() => {
      handler?.(turnEvent('streaming', 2, { delta: 'partial ' }));
    });
    await wait(60);
    act(() => {
      handler?.(turnEvent('streaming', 3, { delta: 'answer' }));
    });
    await wait(60);

    expect(document.body.textContent).toContain('partial answer');

    act(() => {
      handler?.(turnEvent('finished', 4, { steps: [], durationMs: 5, model: 'm' }));
    });
    await wait(30);
  });
});
