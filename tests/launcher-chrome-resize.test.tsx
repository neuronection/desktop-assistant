// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { WINDOW_SIZE } from '@shared/constants/window';
import type { TurnEvent } from '@shared/types';

class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CapturingResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeAll(() => {
  CapturingResizeObserver.instances = [];
  window.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  cleanup();
});

function mockApi(): { resizeWindow: ReturnType<typeof vi.fn> } {
  const listeners: Array<(event: TurnEvent) => void> = [];
  const resizeWindow = vi.fn();
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow,
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  return { resizeWindow };
}

describe('launcher window follows chrome growth', () => {
  it('resizes the window when the composer grows (multiline input)', async () => {
    const { resizeWindow } = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');

    resizeWindow.mockClear();

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 200;
      },
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());

    await waitFor(() => {
      const last = resizeWindow.mock.calls.at(-1);
      expect(last?.[0]).toBe(WINDOW_SIZE.COMPACT_WIDTH);
      expect(last?.[1]).toBe(200 + 4);
    });
  });

  it('keeps the trace strip inside the measured chrome next to the composer', async () => {
    const listeners: Array<(event: TurnEvent) => void> = [];
    const resizeWindow = vi.fn();
    window.electronAPI = {
      loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => null),
      getAllConversations: vi.fn(async () => []),
      onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
        listeners.push(callback);
        return () => {
          const index = listeners.indexOf(callback);
          if (index >= 0) listeners.splice(index, 1);
        };
      }),
      startTurn: vi.fn(async () => 'turn_1'),
      cancelTurn: vi.fn(async () => {}),
      resizeWindow,
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn(() => () => {}),
    } as unknown as typeof window.electronAPI;
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'take a screenshot' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(resizeWindow).toHaveBeenCalled());

    const now = Date.now();
    const base = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };
    listeners.forEach((listener) => listener({ ...base, seq: 1, phase: 'queued' } as TurnEvent));
    listeners.forEach((listener) =>
      listener({
        ...base,
        seq: 2,
        phase: 'thinking',
        node: { node: 'model_request', label: 'Thinking', resumed: false },
        step: {
          id: 'node_model_request_1',
          phase: 'thinking',
          label: 'Thinking',
          startedAt: now,
          node: 'model_request',
        },
      } as TurnEvent)
    );

    expect(screen.getByText('Thinking')).toBeTruthy();
    resizeWindow.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 260;
      },
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());

    await waitFor(() => {
      const last = resizeWindow.mock.calls.at(-1);
      expect(last?.[0]).toBe(WINDOW_SIZE.COMPACT_WIDTH);
      expect(last?.[1]).toBe(260 + 4);
    });
  });
});
