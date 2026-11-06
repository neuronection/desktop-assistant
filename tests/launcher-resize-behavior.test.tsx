// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { WINDOW_SIZE } from '@shared/constants/window';
import { LAUNCHER_RESIZE_SETTLE_MS } from '@renderer/chat-react/launcherResize';
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

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function mockApi(): { resizeWindow: ReturnType<typeof vi.fn>; emit: (event: TurnEvent) => void } {
  const listeners: Array<(event: TurnEvent) => void> = [];
  const resizeWindow = vi.fn();
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => ({
      id: 'temp-1',
      title: 'Test',
      messages: [{ id: 'a1', role: 'assistant', content: 'Hello there', createdAt: new Date() }],
    })),
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
  return {
    resizeWindow,
    emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)),
  };
}

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };

function setScrollHeight(height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return height;
    },
  });
}

describe('launcher auto-resize settling', () => {
  it('grows while streaming and only shrinks after the reply settles', async () => {
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

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect((window.electronAPI.startTurn as ReturnType<typeof vi.fn>)).toHaveBeenCalled());

    emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hello ' } as TurnEvent);
    await screen.findByText('Hello');

    setScrollHeight(250);
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await waitFor(() => expect(resizeWindow.mock.calls.at(-1)?.[1]).toBeGreaterThan(400));
    const grown = resizeWindow.mock.calls.at(-1)?.[1] as number;
    resizeWindow.mockClear();

    setScrollHeight(40);
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await wait(LAUNCHER_RESIZE_SETTLE_MS + 40);
    expect(resizeWindow.mock.calls.some((call) => (call[1] as number) < grown)).toBe(false);

    emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);
    await screen.findByText('Hello there');
    setScrollHeight(40);
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());

    await wait(LAUNCHER_RESIZE_SETTLE_MS / 2);
    expect(resizeWindow.mock.calls.some((call) => (call[1] as number) < grown)).toBe(false);

    await waitFor(() => expect(resizeWindow.mock.calls.at(-1)?.[1]).toBeLessThan(grown), { timeout: 1500 });
    expect(resizeWindow.mock.calls.at(-1)?.[0]).toBe(WINDOW_SIZE.COMPACT_WIDTH);
  });
});
