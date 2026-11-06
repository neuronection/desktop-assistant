// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { HotkeyAction, type TurnEvent } from '@shared/types';
import { WINDOW_SIZE } from '@shared/constants/window';
import { TEXT } from '@shared/constants/text';

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
  Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', { configurable: true, value: () => {} });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  cleanup();
});

const VIEW = {
  builtIns: [
    { action: HotkeyAction.ToggleWindow, label: DEFAULT_CONFIG.hotkeys[HotkeyAction.ToggleWindow].label, accelerator: 'Control+Space' },
    { action: HotkeyAction.SpeakSelection, label: DEFAULT_CONFIG.hotkeys[HotkeyAction.SpeakSelection].label, accelerator: 'CommandOrControl+Shift+S' },
  ],
  commands: [{ action: 'cmd-1', label: 'Summarize page', accelerator: 'Control+Alt+S' }],
};

function mockApi(): Record<string, ReturnType<typeof vi.fn>> {
  const listeners: Array<(event: TurnEvent) => void> = [];
  const api = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      listeners.push(callback);
      return () => {};
    }),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    getShortcuts: vi.fn(async () => ({ ...VIEW })),
    getSpeechSnapshot: vi.fn(async () => null),
    onSpeechState: vi.fn(() => () => {}),
    resizeCornerStart: vi.fn(async () => {}),
    resizeCornerUpdate: vi.fn(async () => {}),
    resizeCornerEnd: vi.fn(async () => {}),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

async function renderApp(): Promise<Record<string, ReturnType<typeof vi.fn>>> {
  const api = mockApi();
  render(<ChatApp onThemeChange={vi.fn()} />);
  await screen.findByRole('textbox');
  return api;
}

const sheet = (): HTMLElement | null => screen.queryByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });

describe('shortcuts sheet in the launcher (plan 59 S2)', () => {
  it('opens with Ctrl+/ and toggles closed with the same chord', async () => {
    await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE })).toBeTruthy();
    expect(await screen.findByText('Summarize page')).toBeTruthy();

    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await waitFor(() => expect(sheet()).toBeNull());
  });

  it('opens from the launcher menu', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: TEXT.LAUNCHER_MORE_BUTTON }));
    const menu = await screen.findByRole('menu', { name: /launcher menu/i });
    fireEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(TEXT.SHORTCUTS_MENU) }));
    expect(await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE })).toBeTruthy();
  });

  it('keeps one popup surface: the chord closes an open menu, the menu closes an open sheet', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: TEXT.LAUNCHER_MORE_BUTTON }));
    expect(await screen.findByRole('menu', { name: /launcher menu/i })).toBeTruthy();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    expect(screen.queryByRole('menu', { name: /launcher menu/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: TEXT.LAUNCHER_MORE_BUTTON }));
    expect(await screen.findByRole('menu', { name: /launcher menu/i })).toBeTruthy();
    expect(sheet()).toBeNull();
  });

  it('ignores the chord while the composer attach menu is open', async () => {
    await renderApp();
    fireEvent.click(screen.getByTitle(TEXT.COMPOSER_ATTACH_FILES));
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    expect(sheet()).toBeNull();

    fireEvent.click(screen.getByTitle(TEXT.COMPOSER_ATTACH_FILES));
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE })).toBeTruthy();
  });

  it('is a compact-mode affordance: expanded mode ignores the chord', async () => {
    await renderApp();
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeTruthy());
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    expect(sheet()).toBeNull();
  });

  it('closes on window hide (visibilitychange)', async () => {
    await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });

    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(sheet()).toBeNull());
    if (descriptor) {
      Object.defineProperty(document, 'visibilityState', descriptor);
    }
  });

  it('exits a manual resize when it opens so the window fits the sheet', async () => {
    const api = await renderApp();
    const handle = screen.getByTestId('window-resize-handle-bottom-right');
    fireEvent.pointerDown(handle, { screenX: 10, screenY: 10, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 180,
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    api.resizeWindow.mockClear();

    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    await waitFor(() => {
      expect(api.resizeWindow).toHaveBeenCalled();
      expect(api.resizeWindow.mock.calls.at(-1)?.[1]).toBe(180);
    });
  });

  it('shows an edited accelerator on the next open (freshness)', async () => {
    const api = await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    expect(screen.getByText('Control+Space')).toBeTruthy();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await waitFor(() => expect(sheet()).toBeNull());

    api.getShortcuts.mockResolvedValueOnce({
      ...VIEW,
      builtIns: [{ ...VIEW.builtIns[0], accelerator: 'Alt+J' }],
    } as never);
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    expect(await screen.findByText('Alt+J')).toBeTruthy();
  });

  it('the CTA closes the sheet, opens Settings → Hotkeys and hides the launcher', async () => {
    const api = await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: TEXT.SHORTCUTS_CUSTOMIZE }));
    await waitFor(() => expect(sheet()).toBeNull());
    expect(api.onSettingsOpen).toHaveBeenCalledWith({ tab: 'hotkeys' });
    expect(api.hideWindow).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the sheet first — the launcher stays', async () => {
    const api = await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    const close = within(dialog).getByRole('button', { name: TEXT.CLOSE_BUTTON });

    fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(sheet()).toBeNull());
    expect(api.hideWindow).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(api.hideWindow).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the composer after closing', async () => {
    await renderApp();
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    textarea.focus();
    fireEvent.keyDown(textarea, { key: '/', code: 'Slash', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    fireEvent.keyDown(within(dialog).getByRole('button', { name: TEXT.CLOSE_BUTTON }), { key: 'Escape' });
    await waitFor(() => expect(sheet()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });

  it('grows and shrinks the measured chrome with the sheet (in-flow, not fixed)', async () => {
    const api = await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    await screen.findByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 320,
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await waitFor(() => {
      const last = api.resizeWindow.mock.calls.at(-1);
      expect(last?.[0]).toBe(WINDOW_SIZE.COMPACT_WIDTH);
      expect(last?.[1]).toBe(320);
    });

    const dialog = screen.getByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    fireEvent.keyDown(within(dialog).getByRole('button', { name: TEXT.CLOSE_BUTTON }), { key: 'Escape' });
    await waitFor(() => expect(sheet()).toBeNull());

    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 140,
    });
    CapturingResizeObserver.instances.forEach((observer) => observer.trigger());
    await waitFor(() => expect(api.resizeWindow.mock.calls.at(-1)?.[1]).toBe(140));
  });

  it('accepts the chord immediately after mount (commit-phase subscription)', async () => {
    await renderApp();
    fireEvent.keyDown(document, { key: '/', code: 'Slash', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: TEXT.SHORTCUTS_TITLE })).toBeTruthy();
  });
});

describe('shortcuts chord subscription contract (455fb7e)', () => {
  it('registers the launcher keydown handler in a layout effect with a latest-ref', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/chat-react/ChatApp.tsx'), 'utf8');
    const match = /useLayoutEffect\(\(\) => \{\s*const handler = \(e: KeyboardEvent\)/.exec(source);
    expect(match, 'the keydown handler lives in a layout effect').not.toBeNull();
    const block = source.slice(
      match!.index,
      source.indexOf("document.addEventListener('keydown', handler)", match!.index)
    );
    expect(block).toContain('keyStateRef.current');
    expect(source).toContain('const keyStateRef = useLatestRef({');
  });
});
