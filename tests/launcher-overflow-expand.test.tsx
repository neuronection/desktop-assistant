// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
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

function mockApi(): { emit: (event: TurnEvent) => void } {
  const listeners: Array<(event: TurnEvent) => void> = [];
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
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  return { emit: (event: TurnEvent) => listeners.forEach((listener) => listener(event)) };
}

describe('launcher response overflow', () => {
  it('highlights the existing expand button instead of switching layout mid-reply', async () => {
    const { emit } = mockApi();
    Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: 1000 });
    const { container } = render(<ChatApp onThemeChange={vi.fn()} />);
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

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 600;
      },
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());

    const expand = await screen.findByRole('button', { name: TEXT.MENU_EXPAND });
    await waitFor(() => expect(expand.getAttribute('data-expand-hint')).toBe('true'));
    expect(expand.textContent?.trim()).toBe('');
    expect(container.querySelector('[data-as="chat-panel-header"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Launcher mode (Ctrl+E)' })).toBeNull();

    fireEvent.click(expand);
    await waitFor(() => expect(container.querySelector('[data-as="chat-panel-header"]')).toBeTruthy());
  });
});
