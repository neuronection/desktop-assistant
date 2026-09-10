// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { WINDOW_SIZE } from '@shared/constants/window';

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
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  cleanup();
});

function mockApi() {
  const resizeWindow = vi.fn();
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow,
    resizeCornerStart: vi.fn(async () => {}),
    resizeCornerUpdate: vi.fn(async () => {}),
    resizeCornerEnd: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  return { resizeWindow };
}

describe('manual resize override', () => {
  it('suspends auto-resize while the user drags a corner handle', async () => {
    const { resizeWindow } = mockApi();
    render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
    await screen.findByRole('textbox');

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 200;
      },
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await waitFor(() => expect(resizeWindow).toHaveBeenCalledWith(WINDOW_SIZE.COMPACT_WIDTH, 204));
    resizeWindow.mockClear();

    const handle = document.querySelector('[data-testid="window-resize-handle-bottom-right"]') as HTMLElement;
    fireEvent.pointerDown(handle, { pointerId: 1, screenX: 100, screenY: 100 });

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return 320;
      },
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resizeWindow).not.toHaveBeenCalled();
  });
});
