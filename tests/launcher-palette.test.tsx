// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  recentIds: [],
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

  it('shows the first-run hint and hides it while typing', async () => {
    mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    const hint = await screen.findByRole('button', { name: /type \/ for commands/i });
    expect(hint).toBeTruthy();
    await typeInput('/calc ');
    expect(screen.queryByRole('button', { name: /type \/ for commands/i })).toBeNull();
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
    await screen.findByText(/web fetch/i);
  });
});
