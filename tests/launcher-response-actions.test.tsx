// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { getWindowSize, WINDOW_SIZE } from '@shared/constants/window';
import { TEXT } from '@shared/constants/text';
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
  await waitFor(() => expect(document.querySelector('[data-as="response-actions"]')).toBeTruthy());
  return api;
}

describe('launcher response area actions', () => {
  it('has no mode buttons in the response header — the input toolbar owns view switching', async () => {
    const { emit } = await startTurn();
    emit({ ...baseEvent, seq: 3, phase: 'streaming', delta: ' there' } as TurnEvent);

    const actions = document.querySelector('[data-as="response-actions"]');
    expect(actions).toBeTruthy();
    expect(actions?.querySelectorAll('button').length).toBeLessThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Open desktop mode (Ctrl+D)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand (Ctrl+E)' })).toBeNull();
  });

  it('opens the view menu from the input toolbar and hands the view over', async () => {
    const { openDesktop } = await startTurn();

    const trigger = screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const menu = await screen.findByTestId('compact-view-menu');
    const options = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map((node) => node.textContent ?? '');
    expect(options).toHaveLength(3);
    expect(options[1]).toContain(TEXT.VIEW_EXPANDED);
    expect(options[2]).toContain(TEXT.VIEW_DESKTOP);

    fireEvent.click(
      Array.from(menu.querySelectorAll('[role="menuitemradio"]')).find((node) =>
        node.textContent?.includes(TEXT.VIEW_DESKTOP)
      ) as HTMLElement
    );
    await waitFor(() => expect(openDesktop).toHaveBeenCalledWith(expect.any(String)));
    expect(screen.queryByTestId('compact-view-menu')).toBeNull();
  });

  it('never renders the monitor action while idle (toolbar stays minimal)', async () => {
    const { resizeWindow } = mockApi();
    render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
    await screen.findByRole('textbox');
    expect(screen.queryByRole('button', { name: 'Open desktop mode (Ctrl+D)' })).toBeNull();
    expect(resizeWindow).toHaveBeenCalled();
  });

  it('never sends the draft when clicking composer toolbar buttons', async () => {
    mockApi();
    render(<StrictMode><ChatApp onThemeChange={vi.fn()} /></StrictMode>);
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'a draft that must not send' } });

    fireEvent.click(screen.getByTitle('Support this project'));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menu')).toBeTruthy();

    expect((textarea as HTMLTextAreaElement).value).toBe('a draft that must not send');
    expect(window.electronAPI.startTurn).not.toHaveBeenCalled();
  });
});
