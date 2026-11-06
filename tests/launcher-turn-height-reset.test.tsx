// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TurnEvent } from '@shared/turns';

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
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(window.screen, 'availHeight');
  cleanup();
});

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };

function mockApi(): { resizeWindow: ReturnType<typeof vi.fn>; emit: (event: TurnEvent) => void } {
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
  return { resizeWindow, emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)) };
}

function setScrollHeight(height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return height;
    },
  });
}

describe('launcher response height across turns', () => {
  it('does not carry the previous reply height into the next turn', async () => {
    const { resizeWindow, emit } = mockApi();
    Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: 1000 });
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textarea = await screen.findByRole('textbox');

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 200;
      },
    });

    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect((window.electronAPI.startTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1));

    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hi ' } as TurnEvent);
    await screen.findByText('Hi');

    setScrollHeight(600);
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await waitFor(() => expect(resizeWindow.mock.calls.at(-1)?.[1]).toBeGreaterThan(550));

    emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);
    await waitFor(() => expect((window.electronAPI.onTurnEvent as ReturnType<typeof vi.fn>)).toBeTruthy());

    resizeWindow.mockClear();
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect((window.electronAPI.startTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2));

    setScrollHeight(40);
    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Yo ' } as TurnEvent);
    await screen.findByText('Yo');

    const heights = resizeWindow.mock.calls.map((call) => call[1] as number);
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThan(500);
  });
});
