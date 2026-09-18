// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { TurnEvent } from '@shared/types';

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

function mockApi(): void {
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
    minimizeWindow: vi.fn(async () => {}),
    openDesktop: vi.fn(async () => {}),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(() => () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
}

describe('startup composer focus', () => {
  it('focuses the launcher composer on mount (first app open sends no focus-input)', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textbox = await screen.findByRole('textbox');
    expect(document.activeElement).toBe(textbox);
  });

  it('focuses the desktop window composer on mount', async () => {
    mockApi();
    render(<StrictMode><DesktopApp /></StrictMode>);
    const textbox = await screen.findByRole('textbox');
    expect(document.activeElement).toBe(textbox);
  });

  it('re-focuses the composer when the renderer remounts (window recreated)', async () => {
    mockApi();
    const { unmount } = render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    unmount();
    cleanup();

    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textbox = await screen.findByRole('textbox');
    expect(document.activeElement).toBe(textbox);
  });
});
