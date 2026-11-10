// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import type { CommandCatalogSnapshot, TurnEvent } from '@shared/turns';
import type { TurnStartRequest } from '@shared/turns';

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
  ],
  recent: [],
  pins: [],
};

function mockApi(config: AppConfig = { ...DEFAULT_CONFIG }) {
  const turnListeners: Array<(event: TurnEvent) => void> = [];
  const api = {
    loadConfig: vi.fn(async () => config),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      turnListeners.push(callback);
      return () => {
        const index = turnListeners.indexOf(callback);
        if (index >= 0) turnListeners.splice(index, 1);
      };
    }),
    startTurn: vi.fn(async () => {}),
    cancelTurn: vi.fn(async () => {}),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    getScreenSources: vi.fn(async () => []),
    getCommandCatalog: vi.fn(async () => CATALOG),
    executeCommand: vi.fn(async () => ({ status: 'done' as const, text: '= 4' })),
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

const NAV_CATALOG: CommandCatalogSnapshot = {
  entries: [
    ...CATALOG.entries,
    {
      id: 'nav:clear-conversation',
      kind: 'builtin',
      title: 'Clear conversation',
      category: 'navigation',
      aliases: ['clear'],
      slash: 'clear',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:clear-conversation',
    },
    {
      id: 'nav:delete-conversation',
      kind: 'builtin',
      title: 'Delete conversation',
      category: 'navigation',
      aliases: ['delete'],
      slash: 'delete',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:delete-conversation',
    },
    {
      id: 'nav:duplicate-conversation',
      kind: 'builtin',
      title: 'Duplicate conversation',
      category: 'navigation',
      aliases: ['duplicate', 'copy'],
      slash: 'duplicate',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:duplicate-conversation',
    },
    {
      id: 'nav:export-conversation',
      kind: 'builtin',
      title: 'Export conversation',
      category: 'navigation',
      aliases: ['export'],
      slash: 'export',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:export-conversation',
    },
  ],
  recent: [],
  pins: [],
};

describe('conversation actions from the palette (plan 74)', () => {
  it('opens the clear confirmation, the delete confirmation and exports the transcript', async () => {
    const api = mockApi();
    api.getCommandCatalog = vi.fn(async () => NAV_CATALOG);
    api.saveFile = vi.fn(async () => ({ success: true }));
    render(<ChatApp onThemeChange={vi.fn()} />);

    const input = await typeInput('/clear');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(input, { key: 'Enter' });
    const clearDialog = await screen.findByRole('dialog');
    expect(within(clearDialog).getByText('Clear conversation')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const deleteInput = await typeInput('/delete');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(deleteInput, { key: 'Enter' });
    const deleteDialog = await screen.findByRole('dialog');
    expect(within(deleteDialog).getByText('Delete conversation')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const duplicateInput = await typeInput('/duplicate');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(duplicateInput, { key: 'Enter' });
    // a temp conversation cannot be duplicated — it stays a local no-op, never a turn
    expect(api.startTurn).not.toHaveBeenCalled();
    expect(api.executeCommand).not.toHaveBeenCalled();

    const exportInput = await typeInput('/export');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(exportInput, { key: 'Enter' });
    await waitFor(() => expect(api.saveFile).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('New Conversation') })));
  });
});

describe('launcher command palette integration', () => {
  it('opens on slash input and has no axe violations', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/');
    const listbox = await screen.findByRole('listbox', { name: /commands/i });
    expect(listbox).toBeTruthy();
    const results = await axe.run(listbox.ownerDocument.body);
    const commandViolations = results.violations
      .filter((violation) => violation.nodes.some((node) => node.target.some((sel) => sel.includes('command'))))
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(commandViolations).toBe('');
  });

  it('executes a builtin through commands:execute and copies the result', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const input = await typeInput('/calc 2+2');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(api.executeCommand).toHaveBeenCalledWith('calc:evaluate', ['2+2'], 'palette'));
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalled());
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('routes tool commands through the turn path with command attribution', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/screenshot');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(api.startTurn).toHaveBeenCalledTimes(1));
    const request = api.startTurn.mock.calls[0][0] as TurnStartRequest;
    expect(request.directTool).toEqual({ name: 'screen_capture', args: {}, commandId: 'tool:screen_capture' });
    expect(api.executeCommand).not.toHaveBeenCalled();
  });

  it('surfaces the slash-command hint via the composer placeholder', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textarea = await screen.findByRole('textbox');
    expect(textarea.getAttribute('placeholder')).toMatch(/\/ for commands/i);
    await typeInput('/calc ');
    expect(textarea.getAttribute('placeholder')).toMatch(/\/ for commands/i);
  });

  it('refreshes the open palette when a config update lands', async () => {
    const api = mockApi();
    const configListeners: Array<() => void> = [];
    api.onConfigUpdate.mockImplementation((callback: () => void) => {
      configListeners.push(callback);
      return () => {};
    });
    let catalog = CATALOG;
    api.getCommandCatalog.mockImplementation(async () => catalog);
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/neuro');
    expect(screen.queryByText(/web fetch/i)).toBeNull();
    // Settings saved an extra alias → the catalog now resolves it (main-side).
    catalog = {
      ...CATALOG,
      entries: [
        ...CATALOG.entries,
        {
          id: 'tool:web_fetch',
          kind: 'tool',
          title: 'Web fetch',
          category: 'web',
          aliases: ['neuro'],
          slash: 'neuro',
          source: 'native' as const,
          scopes: { palette: true, agent: false },
          args: [{ name: 'url', required: true, type: 'string' }],
          toolName: 'web_fetch',
        },
      ],
    };
    configListeners.forEach((listener) => listener());
    await waitFor(() => expect(screen.getAllByText(/web fetch/i).length).toBeGreaterThan(0));
  });
});

describe('palette loading and argument help (plan 77)', () => {
  it('never sends a slash command as a raw turn while the catalog is still loading', async () => {
    const api = mockApi();
    api.getCommandCatalog.mockImplementation(() => new Promise(() => {}));
    render(<ChatApp onThemeChange={vi.fn()} />);
    const input = await typeInput('/remember');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.startTurn).not.toHaveBeenCalled();
    expect(input.value).toBe('/remember');
  });

  it('completes a bare tool command instead of dispatching it without arguments', async () => {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const input = await typeInput('/calc');
    await screen.findByRole('listbox', { name: /commands/i });
    // Enter with the argument missing inserts the command (palette guard) …
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('/calc ');
    expect(api.executeCommand).not.toHaveBeenCalled();
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('shows the signature and help of the highlighted command', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await typeInput('/calc');
    await screen.findByTestId('command-help');
    expect(screen.getByTestId('command-help-usage').textContent).toBe('/calc <expression>');
    expect(screen.getByTestId('command-help-footer').textContent).toMatch(/Needs <expression>/);
  });
});

describe('expanded mode palette', () => {
  async function renderExpanded() {
    const api = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox');
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('Conversation');
    return api;
  }

  it('opens on slash input in expanded mode', async () => {
    await renderExpanded();
    await typeInput('/');
    expect(await screen.findByRole('listbox', { name: /commands/i })).toBeTruthy();
  });

  it('opens via Ctrl+K in expanded mode', async () => {
    await renderExpanded();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('listbox', { name: /commands/i })).toBeTruthy();
  });

  it('executes a builtin through the palette in expanded mode', async () => {
    const api = await renderExpanded();
    await typeInput('/calc 2+2');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(api.executeCommand).toHaveBeenCalledWith('calc:evaluate', ['2+2'], 'palette'));
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalled());
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('escape closes the palette and stays in expanded mode', async () => {
    const api = await renderExpanded();
    await typeInput('/');
    await screen.findByRole('listbox', { name: /commands/i });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /commands/i })).toBeNull());
    expect(screen.getByText('Conversation')).toBeTruthy();
    expect(api.hideWindow).not.toHaveBeenCalled();
  });
});
