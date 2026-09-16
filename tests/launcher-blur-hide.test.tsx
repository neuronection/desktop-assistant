// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
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

function mockApi(hideOnBlur: boolean): { hideWindow: ReturnType<typeof vi.fn> } {
  const listeners: Array<(event: TurnEvent) => void> = [];
  const hideWindow = vi.fn();
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({
      ...DEFAULT_CONFIG,
      behavior: { ...DEFAULT_CONFIG.behavior, hideOnBlur },
    }) as AppConfig),
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
    hideWindow,
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
  } as unknown as typeof window.electronAPI;
  return { hideWindow };
}

const blurWindow = (): void => {
  window.dispatchEvent(new Event('blur'));
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 250));

describe('launcher click-away hide (behavior.hideOnBlur)', () => {
  it('stays up on blur when the setting is off (default)', async () => {
    const { hideWindow } = mockApi(false);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    blurWindow();
    await settle();
    expect(hideWindow).not.toHaveBeenCalled();
  });

  it('hides on blur when the setting is enabled', async () => {
    const { hideWindow } = mockApi(true);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    blurWindow();
    await vi.waitFor(() => expect(hideWindow).toHaveBeenCalledTimes(1));
  });

  it('ignores blur when the document regained focus within the confirm window', async () => {
    const { hideWindow } = mockApi(true);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    blurWindow();
    await settle();
    expect(hideWindow).not.toHaveBeenCalled();
  });
});
