// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { CommandCatalogSnapshot } from '@shared/turns';

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
      id: 'tool:translate',
      kind: 'tool',
      title: 'Translate',
      category: 'tools',
      aliases: ['tr', 'translate'],
      slash: 'tr',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [
        { name: 'text', required: true, type: 'string' },
        { name: 'target', required: false, type: 'string' },
        { name: 'source', required: false, type: 'string' },
      ],
      toolName: 'translate',
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
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG, translation: { ...DEFAULT_CONFIG.translation, padDebounceMs: 300 } })),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn(() => () => {}),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resumeTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(async () => {}),
    openDesktop: vi.fn(async () => {}),
    openLauncher: vi.fn(async () => {}),
    onLauncherSetMode: vi.fn(() => () => {}),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    saveFile: vi.fn(async () => ({ success: true })),
    setConversationMetadata: vi.fn(async () => {}),
    getCommandCatalog: vi.fn(async () => CATALOG),
    executeCommand: vi.fn(async () => ({ status: 'done' as const, text: '= 4' })),
    writeToClipboard: vi.fn(async () => true),
    clearCommandHistory: vi.fn(async () => true),
    translateText: vi.fn(async () => ({ text: 'Καλημέρα', engine: 'deepl', target: 'el', source: 'en' })),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

async function typeInput(value: string): Promise<HTMLTextAreaElement> {
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value } });
  return input;
}

async function openPad(input: string): Promise<HTMLTextAreaElement> {
  await typeInput(input);
  await screen.findByRole('listbox', { name: /commands/i });
  fireEvent.keyDown(document, { key: 'Enter' });
  return screen.findByRole('textbox') as Promise<HTMLTextAreaElement>;
}

describe('desktop mini apps', () => {
  it('opens the calculator pad from bare /calc and copies on Enter', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    const input = await openPad('/calc');
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Calculator')).toBeTruthy();
    expect(api.startTurn).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '7*6' } });
    await screen.findByRole('status');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('42'));
    expect(api.startTurn).not.toHaveBeenCalled();
    expect(screen.getByText('Calculator')).toBeTruthy();
  });

  it('keeps the pad open for consecutive calculations', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    const input = (await openPad('/calc')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '2+2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('4'));
    expect(screen.getByText('Calculator')).toBeTruthy();
    fireEvent.change(input, { target: { value: '10*10' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('= 100'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('100'));
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('opens the translate pad with a target and copies the result', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    const input = (await openPad('/tr el')) as HTMLTextAreaElement;
    expect(screen.getByText('Translate → el')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Good morning' } });
    await screen.findByText('Καλημέρα');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('Καλημέρα'));
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('exits the pad on Escape and restores the normal composer', async () => {
    mockApi();
    render(<DesktopApp />);
    await openPad('/calc');
    expect(screen.getByText('Calculator')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Calculator')).toBeNull());
    expect(screen.queryByPlaceholderText(/Type an expression/i)).toBeNull();
  });

  it('hands off to the launcher window in compact or expanded mode', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    await screen.findByRole('textbox');
    fireEvent.click(screen.getByTitle('Open launcher mode'));
    expect(api.openLauncher).toHaveBeenCalledWith('compact', expect.any(String));
    fireEvent.click(screen.getByTitle('Open expanded mode'));
    expect(api.openLauncher).toHaveBeenCalledWith('expanded', expect.any(String));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('desktop surface with an open pad has no axe violations', async () => {
    mockApi();
    render(<DesktopApp />);
    const input = await openPad('/tr el');
    fireEvent.change(input, { target: { value: 'hello' } });
    await screen.findByText('Καλημέρα');
    const results = await axe.run(document.body);
    const summary = results.violations
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});
