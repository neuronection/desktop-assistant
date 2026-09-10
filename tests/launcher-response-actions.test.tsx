// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { getWindowSize, WINDOW_SIZE } from '@shared/constants/window';
import { WindowState } from '@shared/types';
import type { TurnEvent } from '@shared/types';

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

function mockApi() {
  const listeners: Array<(event: TurnEvent) => void> = [];
  const openDesktop = vi.fn(async () => {});
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
    resizeCornerStart: vi.fn(async () => {}),
    resizeCornerUpdate: vi.fn(async () => {}),
    resizeCornerEnd: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop,
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  const emit = (event: TurnEvent) => listeners.forEach((listener) => listener(event));
  return { openDesktop, resizeWindow, emit };
}

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'real-1', model: 'm1' };

async function startTurn(): Promise<{ openDesktop: ReturnType<typeof vi.fn>; resizeWindow: ReturnType<typeof vi.fn>; emit: (event: TurnEvent) => void }> {
  const api = mockApi();
  render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect(window.electronAPI.startTurn as ReturnType<typeof vi.fn>).toHaveBeenCalled());
  api.emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
  api.emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hi' } as TurnEvent);
  await screen.findByRole('button', { name: 'Open desktop mode (Ctrl+D)' });
  return api;
}

describe('launcher response area actions', () => {
  it('offers discreet desktop-mode and expand buttons inside the response panel', async () => {
    const { emit, openDesktop, resizeWindow } = await startTurn();

    const desktopButton = screen.getByRole('button', { name: 'Open desktop mode (Ctrl+D)' });
    expect(screen.getByRole('button', { name: 'Expand (Ctrl+E)' })).toBeTruthy();

    fireEvent.click(desktopButton);
    await waitFor(() => expect(openDesktop).toHaveBeenCalledWith(expect.any(String)));

    fireEvent.click(screen.getByRole('button', { name: 'Expand (Ctrl+E)' }));
    const expanded = getWindowSize(WindowState.EXPANDED, null, false);
    await waitFor(() => expect(resizeWindow).toHaveBeenCalledWith(expanded.width, expanded.height));
  });

  it('keeps desktop mode out of the compact toolbar and inside the more-menu instead', async () => {
    const { emit } = await startTurn();

    emit({ ...baseEvent, seq: 3, phase: 'streaming', delta: ' there' } as TurnEvent);

    const toolbar = screen.getAllByRole('button', { name: 'More' });
    expect(toolbar).toHaveLength(1);

    fireEvent.click(toolbar[0]);
    const menu = await screen.findByRole('menu');
    const item = Array.from(menu.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.includes('Open desktop mode')
    );
    expect(item).toBeTruthy();
  });

  it('never renders the monitor action while idle (toolbar stays minimal)', async () => {
    const { resizeWindow } = mockApi();
    render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: 'Open desktop mode (Ctrl+D)' })).toBeNull();
    expect(resizeWindow).toHaveBeenCalled();
  });});
