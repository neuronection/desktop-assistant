// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { NotificationService } from '@renderer/services/NotificationService';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { CommandCatalogSnapshot, TurnEvent } from '@shared/turns';

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
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(cleanup);

const CATALOG: CommandCatalogSnapshot = {
  entries: [
    {
      id: 'calc:evaluate',
      kind: 'builtin',
      title: 'Calculator',
      category: 'tools',
      aliases: ['calc'],
      slash: 'calc',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [{ name: 'expression', required: true, type: 'string' }],
      action: 'calc:evaluate',
    },
    {
      id: 'tool:screen_capture',
      kind: 'tool',
      title: 'Screen capture',
      category: 'tools',
      aliases: ['screenshot'],
      slash: 'screenshot',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'screen_capture',
    },
    {
      id: 'nav:quit',
      kind: 'builtin',
      title: 'Quit Desktop Assistant',
      category: 'navigation',
      aliases: ['quit', 'exit'],
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:quit',
    },
  ],
  recentIds: [],
  pins: [],
};

function mockApi() {
  const api = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
    saveConfig: vi.fn(async () => {}),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => {}),
    cancelTurn: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    onLauncherOpenPalette: vi.fn(() => () => {}),
    getScreenSources: vi.fn(async () => []),
    getCommandCatalog: vi.fn(async () => CATALOG),
    executeCommand: vi.fn(async () => ({ status: 'done' as const, text: '= 14' })),
    writeToClipboard: vi.fn(async () => true),
    clearCommandHistory: vi.fn(async () => true),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

async function typeInput(value: string): Promise<HTMLTextAreaElement> {
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('launcher mini-app mode (plan 14 §9)', () => {
  it('entering Calculator mode swaps the input surface and border', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    const input = await screen.findByPlaceholderText(/Type an expression/i);
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Calculator')).toBeTruthy();
    expect(screen.getByRole('button', { name: /exit calculator/i })).toBeTruthy();
    expect(api0().startTurn).not.toHaveBeenCalled();
  });

  function api0() {
    return window.electronAPI as unknown as {
      startTurn: ReturnType<typeof vi.fn>;
      executeCommand: ReturnType<typeof vi.fn>;
      writeToClipboard: ReturnType<typeof vi.fn>;
    };
  }

  it('evaluates live and copies the result on Enter', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    const input = await screen.findByPlaceholderText(/Type an expression/i);
    fireEvent.change(input, { target: { value: '2+3*4' } });
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('= 14');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('14'));
  });

  it('copies via the clickable result row', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    const input = await screen.findByPlaceholderText(/Type an expression/i);
    fireEvent.change(input, { target: { value: '7*6' } });
    const row = await screen.findByRole('status');
    expect(row.textContent).toContain('Copy');
    fireEvent.click(row);
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('42'));
    expect(screen.getByText(/result copied/i)).toBeTruthy();
  });

  it('exits the mode on Escape and restores the normal composer', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByPlaceholderText(/Type an expression/i);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Calculator')).toBeNull();
    expect(screen.queryByPlaceholderText(/Type an expression/i)).toBeNull();
  });

  it('enters the mode from the row menu Open action', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const input = await typeInput('/calc');
    const option = await screen.findByRole('option', { name: /calculator/i });
    fireEvent.contextMenu(option.firstElementChild ?? option);
    fireEvent.click(screen.getByRole('button', { name: /open/i }));
    await screen.findByPlaceholderText(/Type an expression/i);
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('makes /exit context-sensitive: exits the mini app instead of quitting', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByPlaceholderText(/Type an expression/i);
    const exitInput = await typeInput('/exit');
    fireEvent.keyDown(exitInput, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByText('Calculator')).toBeNull());
    expect(api.executeCommand).not.toHaveBeenCalledWith('nav:quit', expect.anything(), expect.anything());
  });

  it('blocks other commands while a mini app is open', async () => {
    const api = mockApi();
    NotificationService.setHandler((message, type) => {
      window.dispatchEvent(new CustomEvent('da-notice', { detail: { type, message } }));
    });
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByPlaceholderText(/Type an expression/i);
    const input = await typeInput('/screenshot');
    expect(screen.queryByRole('option', { name: /screen capture/i })).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('exit the mini app first'));
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('still evaluates inline when arguments are provided', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc 2+2');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(api.executeCommand).toHaveBeenCalledWith('calc:evaluate', ['2+2'], 'palette'));
  });
});
