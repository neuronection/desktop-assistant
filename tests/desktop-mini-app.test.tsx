// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DesktopApp } from '@renderer/chat-react/DesktopApp';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
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
  recent: [],
  pins: [],
};

function mockApi() {
  const turnListeners: Array<(event: TurnEvent) => void> = [];
  const api = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async () => null),
    getMessagesByConversation: vi.fn(async () => []),
    getUiState: vi.fn(async () => ({})),
    saveUiState: vi.fn(async () => {}),
    getConversationTree: vi.fn(async () => ({ activeRootId: null, nodes: [] })),
    setConversationMetadata: vi.fn(async () => {}),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      turnListeners.push(callback);
      return () => {
        const index = turnListeners.indexOf(callback);
        if (index >= 0) turnListeners.splice(index, 1);
      };
    }),
    emitTurn: (event: TurnEvent) => turnListeners.forEach((listener) => listener(event)),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resumeTurn: vi.fn(async () => true),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    minimizeWindow: vi.fn(async () => {}),
    toggleFullScreenWindow: vi.fn(async () => true),
    toggleMaximizeWindow: vi.fn(async () => {}),
    updateConversation: vi.fn(async () => ({})),
    duplicateConversation: vi.fn(async () => ({ id: 'copy-1', title: 'Copy of New Conversation' })),
    saveFile: vi.fn(async () => ({ success: true })),
    openDesktop: vi.fn(async () => {}),
    openLauncher: vi.fn(async () => {}),
    onLauncherSetMode: vi.fn(() => () => {}),
    onSessionSync: vi.fn(() => () => {}),
    getToolCatalog: vi.fn(async () => []),
    onSettingsOpen: vi.fn(async () => {}),
    setConversationMetadata: vi.fn(async () => {}),
    getCommandCatalog: vi.fn(async () => CATALOG),
    executeCommand: vi.fn(async () => ({ status: 'done' as const, text: '= 4' })),
    writeToClipboard: vi.fn(async () => true),
    clearCommandHistory: vi.fn(async () => true),
    getMiniApps: async () => ({ masterEnabled: true, removedBundled: [], packs: [
      { id: 'mini-calc', version: '1.1.0', kind: 'surface', title: 'Calculator', capabilities: ['ui'], enabled: true, originKind: 'bundled', commands: ['calc:evaluate'], configFields: [], configValues: {} },
      {
        id: 'mini-translate', version: '1.4.0', kind: 'surface', title: 'Translate', capabilities: ['ui', 'llm'], enabled: true, originKind: 'bundled', commands: ['tool:translate'],
        configFields: [], configValues: { sourceCode: 'auto', targetCode: 'el', padDebounceMs: 300 },
        launchOptions: [
          { id: 'source', label: 'Source', type: 'select', configKey: 'sourceCode', vocabulary: { vocabulary: 'languages', withAuto: true, allowCustom: true } },
          { id: 'target', label: 'Target', type: 'select', configKey: 'targetCode', vocabulary: { vocabulary: 'languages', allowCustom: true } },
          { id: 'engine', label: 'Engine', type: 'select', configKey: 'engineMode', choices: [
            { value: 'inherit', label: 'Configured default' },
            { value: 'auto', label: 'Services, then model' },
            { value: 'service', label: 'Service providers only' },
            { value: 'llm', label: 'Model only' },
          ] },
        ],
      },
    ] }),
    getMiniAppSources: async () => ({ sources: [], installs: [] }),
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
    expect(screen.getByText('Translate')).toBeTruthy();
    expect(screen.getByText('→ el')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Good morning' } });
    await screen.findByText('Καλημέρα');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.writeToClipboard).toHaveBeenCalledWith('Καλημέρα'));
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('changes the direction from the pad Settings without leaving desktop mode', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    const input = (await openPad('/tr el')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(await screen.findByTestId('mini-app-options'));
    await screen.findByTestId('launch-pane');
    expect(screen.getByTestId('launch-primary').textContent).toBe('Apply');
    expect(screen.getByText('→ el')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello');
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('toggles the conversation history panel from the header and closes it in place', async () => {
    mockApi();
    render(<DesktopApp />);
    const aside = await screen.findByLabelText('Conversations');
    expect(aside).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.LAUNCHER_HISTORY_CLOSE }));
    expect(screen.queryByLabelText('Conversations')).toBeNull();
    const toggle = screen.getByRole('button', { name: TEXT.LAUNCHER_HISTORY_SHOW });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByLabelText('Conversations')).toBeTruthy();
    expect(screen.getByRole('button', { name: TEXT.LAUNCHER_HISTORY_HIDE }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps Clear out of the title bar and at the foot of the conversation rail', async () => {
    mockApi();
    render(<DesktopApp />);
    await screen.findByLabelText('Conversations');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    const clear = screen.getByTestId('clear-conversation');
    expect(clear.getAttribute('aria-label')).toBe(TEXT.LAUNCHER_CLEAR_CONVERSATION);
    expect((clear as HTMLButtonElement).disabled).toBe(true);
  });

  it('groups the rail by date and offers rename and export on each conversation', async () => {
    const api = mockApi();
    const today = new Date().toISOString();
    const earlier = new Date(Date.now() - 3 * 86_400_000).toISOString();
    api.getAllConversations = vi.fn(async () => [
      { id: 'c1', title: 'Today chat', updatedAt: today },
      { id: 'c2', title: 'Older chat', updatedAt: earlier },
    ]) as never;
    render(<DesktopApp />);
    expect(await screen.findByText('Today')).toBeTruthy();
    expect(screen.getByText('Earlier')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    const input = await screen.findByRole('textbox', { name: 'Conversation title' });
    fireEvent.change(input, { target: { value: 'Renamed chat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateConversation).toHaveBeenCalledWith('c1', 'Renamed chat'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Export' })[0]);
    await waitFor(() => expect(api.saveFile).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Today chat') })));
  });

  it('maximizes on a title-bar double-click, but not on its buttons', async () => {
    const api = mockApi();
    const { container } = render(<DesktopApp />);
    await screen.findByRole('textbox');
    const header = container.querySelector("[data-as='chat-panel-header']");
    expect(header).toBeTruthy();
    fireEvent.doubleClick(header as HTMLElement);
    expect(api.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(screen.getByRole('button', { name: TEXT.LAUNCHER_HISTORY_HIDE }));
    expect(api.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
  });

  it('duplicates the conversation from the rail footer and opens the copy', async () => {
    const api = mockApi();
    let delivered = false;
    const transcriptMessage = { id: 'm1', role: 'assistant', content: 'Hi', createdAt: new Date().toISOString() };
    api.getConversationById = vi.fn(async (id: string) => ({
      id,
      title: id === 'real-1' ? 'Real chat' : 'Copy',
      messages: delivered ? [transcriptMessage] : [],
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as never;
    api.getMessagesByConversation = vi.fn(async () =>
      delivered ? [{ id: 'm1', role: 'assistant', content: 'Hi', createdAt: new Date().toISOString() }] : []
    ) as never;
    render(<DesktopApp />);
    const input = await screen.findByRole('textbox');
    const footer = await screen.findByTestId('duplicate-conversation');
    expect((footer as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.startTurn).toHaveBeenCalled());
    api.emitTurn({ tempMessageId: 'turn_1', conversationId: 'real-1', seq: 1, phase: 'queued' } as TurnEvent);
    api.emitTurn({ tempMessageId: 'turn_1', conversationId: 'real-1', seq: 2, phase: 'streaming', delta: 'Hi' } as TurnEvent);
    delivered = true;
    api.emitTurn({ tempMessageId: 'turn_1', conversationId: 'real-1', seq: 3, phase: 'finished' } as TurnEvent);

    await waitFor(() => expect((screen.getByTestId('duplicate-conversation') as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(api.getConversationById).toHaveBeenCalledWith('real-1'));
    fireEvent.click(screen.getByTestId('duplicate-conversation'));
    const listCallsBefore = api.getAllConversations.mock.calls.length;
    await waitFor(() => expect(api.duplicateConversation).toHaveBeenCalledWith('real-1'));
    await waitFor(() => expect(api.getConversationById).toHaveBeenCalledWith('copy-1'));
    // the copy must land in the rail, not only in the transcript
    await waitFor(() => expect(api.getAllConversations.mock.calls.length).toBeGreaterThan(listCallsBefore));
    document.getElementById('notification-container')?.replaceChildren();
  });

  it('persists the rail and inspector visibility as window state', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    fireEvent.click(await screen.findByRole('button', { name: TEXT.LAUNCHER_HISTORY_CLOSE }));
    await waitFor(() => expect(api.saveUiState).toHaveBeenCalledWith({ desktopHistoryVisible: false }));
    fireEvent.click(screen.getByTitle(TEXT.DESKTOP_SHOW_INSPECTOR));
    await waitFor(() => expect(api.saveUiState).toHaveBeenCalledWith({ inspectorVisible: true }));
  });

  it('closes the inspector from its header, like the history panel', async () => {
    mockApi();
    render(<DesktopApp />);
    fireEvent.click(await screen.findByTitle(TEXT.DESKTOP_SHOW_INSPECTOR));
    const close = await screen.findByTestId('inspector-close');
    expect(close.getAttribute('aria-label')).toBe(TEXT.DESKTOP_INSPECTOR_CLOSE);
    expect(screen.getByText(TEXT.DESKTOP_INSPECTOR_TITLE)).toBeTruthy();
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByTestId('inspector-close')).toBeNull());
    expect(screen.getByTitle(TEXT.DESKTOP_SHOW_INSPECTOR)).toBeTruthy();
  });

  it('enters and leaves full screen from the header', async () => {
    const api = mockApi();
    (api.toggleFullScreenWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<DesktopApp />);
    const enter = await screen.findByRole('button', { name: TEXT.DESKTOP_FULLSCREEN });
    fireEvent.click(enter);
    await waitFor(() => expect(api.toggleFullScreenWindow).toHaveBeenCalledTimes(1));
    const exit = await screen.findByRole('button', { name: TEXT.DESKTOP_EXIT_FULLSCREEN });
    expect(exit.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(exit);
    await waitFor(() => expect(screen.getByRole('button', { name: TEXT.DESKTOP_FULLSCREEN })).toBeTruthy());
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

  it('hands off to the launcher window from the one view switcher', async () => {
    const api = mockApi();
    render(<DesktopApp />);
    await screen.findByRole('textbox');
    const switcher = screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA });
    expect(switcher.textContent).toContain(TEXT.VIEW_DESKTOP);
    fireEvent.click(switcher);
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_COMPACT) }));
    expect(api.openLauncher).toHaveBeenCalledWith('compact', expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: TEXT.SWITCH_VIEW_ARIA }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(TEXT.VIEW_EXPANDED) }));
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
