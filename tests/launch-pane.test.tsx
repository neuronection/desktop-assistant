// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { LaunchPane } from '@renderer/shared/LaunchPane';
import { miniAppForLiveOptions, type MiniApp } from '@renderer/chat-react/miniApps';
import { setSurfacePackViews } from '@renderer/chat-react/surfacePackState';
import { translateRenderer } from '@packs/mini-translate/renderer';
import type { CommandEntry } from '@shared/commands';
import type { MiniAppView } from '@shared/app-pack';
import type { CommandCatalogSnapshot } from '@shared/commands';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';

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

function translateView(): MiniAppView {
  return {
    id: 'mini-translate',
    version: '1.2.0',
    kind: 'surface',
    title: 'Translate',
    capabilities: ['ui', 'llm'],
    enabled: true,
    originKind: 'bundled',
    commands: ['tool:translate'],
    configFields: [{ name: 'targetCode', type: 'string', default: 'en' }],
    configValues: { padDebounceMs: 1500, sourceCode: 'auto', targetCode: 'el' },
    launchOptions: [
      {
        id: 'source',
        label: 'Source',
        type: 'select',
        configKey: 'sourceCode',
        choices: [
          { value: 'auto', label: 'Automatic' },
          { value: 'en', label: 'en' },
        ],
      },
      {
        id: 'target',
        label: 'Target',
        type: 'select',
        configKey: 'targetCode',
        choices: ['en', 'el', 'de', 'fr', 'es'].map((code) => ({ value: code, label: code })),
      },
    ],
  };
}

function reviewView(): MiniAppView {
  return {
    id: 'file-deletion-review',
    version: '1.1.0',
    kind: 'assessment',
    title: 'Deletion review',
    capabilities: ['fs-read', 'run', 'report'],
    enabled: true,
    originKind: 'bundled',
    commands: [],
    configFields: [{ name: 'readContext', type: 'boolean', default: true }],
    configValues: { readContext: true },
    launchOptions: [
      { id: 'root', label: 'Folder', type: 'path', required: true },
      { id: 'read-context', label: 'Read context', type: 'switch', configKey: 'readContext' },
    ],
  };
}

function calcView(): MiniAppView {
  return {
    id: 'mini-calc',
    version: '1.0.0',
    kind: 'surface',
    title: 'Calculator',
    capabilities: ['ui'],
    enabled: true,
    originKind: 'bundled',
    commands: ['calc:evaluate'],
    configFields: [],
    configValues: {},
  };
}

describe('LaunchPane — persist, dispatch, escape (plan 53 S3)', () => {
  function mockMenuApi(overrides: Record<string, unknown> = {}): void {
    window.electronAPI = {
      saveMiniAppConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values })),
      ...overrides,
    } as unknown as typeof window.electronAPI;
  }

  it('persists config-bound values through the one store, then dispatches with the values', async () => {
    mockMenuApi();
    const onLaunch = vi.fn(async () => undefined);
    render(<LaunchPane pack={reviewView()} onBack={vi.fn()} onLaunch={onLaunch} />);
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/tmp/demo' } });
    fireEvent.click(screen.getByTestId('launch-option-read-context-switch'));
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith({ root: '/tmp/demo', 'read-context': false }));
    expect(window.electronAPI.saveMiniAppConfig).toHaveBeenCalledWith('file-deletion-review', { readContext: false });
  });

  it('launches anyway with a notice when the config write fails', async () => {
    mockMenuApi({ saveMiniAppConfig: vi.fn(async () => ({ ok: false, error: 'locked', values: {} })) });
    const onLaunch = vi.fn(async () => undefined);
    render(<LaunchPane pack={reviewView()} onBack={vi.fn()} onLaunch={onLaunch} />);
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/tmp/demo' } });
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(onLaunch).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('still uses your choices');
  });

  it('keeps the pane open and shows the host error under its field', async () => {
    mockMenuApi();
    const onLaunch = vi.fn(async () => ({ error: { optionId: 'root', message: 'Refused root' } }));
    render(<LaunchPane pack={reviewView()} onBack={vi.fn()} onLaunch={onLaunch} />);
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/etc' } });
    fireEvent.click(screen.getByTestId('launch-primary'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('launch-option-root').textContent).toContain('Refused root');
  });

  it('Escape and the back button both step back; the first control takes focus', () => {
    mockMenuApi();
    const onBack = vi.fn();
    render(<LaunchPane pack={reviewView()} onBack={onBack} onLaunch={vi.fn(async () => undefined)} />);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('launch-option-root-input');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('launch-back'));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('hides the back affordance inside modal hosts but keeps Escape', () => {
    mockMenuApi();
    const onBack = vi.fn();
    render(<LaunchPane pack={reviewView()} showBack={false} onBack={onBack} onLaunch={vi.fn(async () => undefined)} />);
    expect(screen.queryByTestId('launch-back')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('preempts the app-level Escape ladder (capture phase before document bubble)', () => {
    mockMenuApi();
    let ladder = 0;
    const ladderListener = (): void => {
      ladder += 1;
    };
    document.addEventListener('keydown', ladderListener);
    const onBack = vi.fn();
    render(<LaunchPane pack={reviewView()} onBack={onBack} onLaunch={vi.fn(async () => undefined)} />);
    fireEvent.keyDown(screen.getByTestId('launch-option-root-input'), { key: 'Escape' });
    document.removeEventListener('keydown', ladderListener);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(ladder).toBe(0);
  });

  it('is axe-clean', { timeout: 30_000 }, async () => {
    mockMenuApi();
    const { container } = render(<LaunchPane pack={reviewView()} onBack={vi.fn()} onLaunch={vi.fn(async () => undefined)} />);
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id).join(',')).toBe('');
  });
});

const CATALOG: CommandCatalogSnapshot = {
  entries: [
    {
      id: 'tool:translate',
      kind: 'tool',
      title: 'Translate',
      category: 'tools',
      aliases: ['tr'],
      slash: 'tr',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'translate',
    },
    {
      id: 'miniapp:run:file-deletion-review',
      kind: 'builtin',
      title: 'Deletion review',
      category: 'apps',
      aliases: ['file-deletion-review'],
      slash: 'file-deletion-review',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'miniapp:run-start',
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
      args: [],
      action: 'calc:evaluate',
    },
  ],
  recentIds: [],
  pins: [],
};

function mockChatApi(overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG })),
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
    getScreenSources: vi.fn(async () => []),
    getCommandCatalog: vi.fn(async () => CATALOG),
    executeCommand: vi.fn(async () => ({ status: 'done', text: 'ok' })),
    writeToClipboard: vi.fn(async () => {}),
    getMiniApps: vi.fn(async () => ({
      masterEnabled: true,
      packs: [translateView(), reviewView(), calcView()],
      removedBundled: [],
    })),
    saveMiniAppConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values })),
    startMiniAppRun: vi.fn(async () => ({ ok: true, runId: 'run-9' })),
    miniAppRunReport: vi.fn(async () => ({ run: { conversationId: 'conv-9' } })),
    pickMiniAppRoot: vi.fn(async () => ({ ok: true, root: '/picked/folder' })),
    ...overrides,
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

async function openPaletteWith(query: string): Promise<HTMLTextAreaElement> {
  render(<ChatApp onThemeChange={vi.fn()} />);
  const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: `/${query}` } });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeTruthy());
  return textarea;
}

describe('ChatApp — palette launch pane (plan 53 S3.1–S3.3)', () => {
  it('opens the launch pane instead of the pad/surface, and Enter on the menu persists then opens with options', async () => {
    const api = mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(await screen.findByTestId('launch-pane')).toBeTruthy();
    expect(api.executeCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId('launch-primary').textContent).toBe('Open');
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(api.saveMiniAppConfig).toHaveBeenCalledWith('mini-translate', expect.objectContaining({ sourceCode: 'auto', targetCode: 'el' })));
    const chip = await screen.findByTestId('mini-app-options');
    expect(chip.textContent).toContain('Translate');
    expect(chip.textContent).toContain('el');
  });

  it('Escape steps back to the palette list with the query preserved', async () => {
    mockChatApi();
    const textarea = await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(textarea.value).toBe('/translate');
    expect(document.activeElement).toBe(textarea);
  });

  it('runs an assessment pack with the chosen folder and jumps to its conversation', async () => {
    const api = mockChatApi();
    await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    expect((screen.getByTestId('launch-primary') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/tmp/demo' } });
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(api.startMiniAppRun).toHaveBeenCalledWith('file-deletion-review', '/tmp/demo'));
    expect(api.saveMiniAppConfig).toHaveBeenCalledWith('file-deletion-review', { readContext: true });
    await waitFor(() => expect(api.openDesktop).toHaveBeenCalledWith('conv-9'));
    expect(screen.queryByTestId('launch-pane')).toBeNull();
  });

  it('Runs history deep-links to the pack Runs page (packId only) and closes the pane', async () => {
    const api = mockChatApi();
    await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-runs'));
    await waitFor(() => expect(api.onSettingsOpen).toHaveBeenCalledWith({ tab: 'apps', miniAppsReportPackId: 'file-deletion-review' }));
    expect(screen.queryByTestId('launch-pane')).toBeNull();
  });

  it('Configure deep-links to the pack settings page and closes the pane', async () => {
    const api = mockChatApi();
    await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-configure'));
    await waitFor(() => expect(api.onSettingsOpen).toHaveBeenCalledWith({ tab: 'apps', miniAppsConfigurePackId: 'file-deletion-review' }));
    expect(screen.queryByTestId('launch-pane')).toBeNull();
  });

  it('shows the run-start error inline and keeps the pane open', async () => {
    const api = mockChatApi({ startMiniAppRun: vi.fn(async () => ({ ok: false, error: 'refused root' })) });
    await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/etc' } });
    fireEvent.click(screen.getByTestId('launch-primary'));
    const alert = await screen.findByTestId('launch-error');
    expect(alert.textContent).toContain('refused root');
    expect(api.openDesktop).not.toHaveBeenCalled();
    expect(screen.getByTestId('launch-pane')).toBeTruthy();
  });

  it('a run pack whose view has no path option falls back to the legacy command (stale manifest)', async () => {
    const api = mockChatApi({
      getMiniApps: vi.fn(async () => ({
        masterEnabled: true,
        packs: [{ ...reviewView(), launchOptions: undefined }, translateView(), calcView()],
        removedBundled: [],
      })),
    });
    await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(api.executeCommand).toHaveBeenCalledWith('miniapp:run:file-deletion-review', [], 'palette'));
    expect(screen.queryByTestId('launch-pane')).toBeNull();
  });

  it('a pack without a launch menu keeps its direct behavior (no pane)', async () => {
    const api = mockChatApi();
    await openPaletteWith('calc');
    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Calculator')).toBeTruthy());
    expect(screen.queryByTestId('launch-pane')).toBeNull();
    expect(screen.queryByTestId('mini-app-options')).toBeNull();
    expect(api.executeCommand).not.toHaveBeenCalled();
  });

  it('mid-session: the options chip reopens the menu pre-filled; Apply updates the live pad', async () => {
    const api = mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-primary'));
    const chip = await screen.findByTestId('mini-app-options');
    expect(chip.textContent).toContain('el');
    fireEvent.click(chip);
    await screen.findByTestId('launch-pane');
    expect(screen.getByTestId('launch-primary').textContent).toBe('Apply');
    fireEvent.click(within(screen.getByTestId('launch-option-target-select')).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'de' }));
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(screen.getByTestId('mini-app-options').textContent).toContain('de'));
    expect(api.saveMiniAppConfig).toHaveBeenCalledWith('mini-translate', expect.objectContaining({ targetCode: 'de' }));
  });
});

describe('translate binding — launch options (plan 53 S3.4)', () => {
  const translateEntry: CommandEntry = {
    id: 'tool:translate',
    kind: 'tool',
    title: 'Translate',
    category: 'tools',
    aliases: ['tr'],
    slash: 'tr',
    source: 'native',
    scopes: { palette: true, agent: false },
    args: [],
    toolName: 'translate',
  };
  const base: MiniApp = {
    id: 'tool:translate',
    packId: 'mini-translate',
    title: 'Translate',
    icon: translateRenderer.icon,
    accent: 'var(--as-primary)',
    placeholder: 'x',
    hint: 'y',
  };

  it('maps source/target option ids onto the pad state and a non-stacking title', () => {
    const opened = translateRenderer.applyOpenOptions!(base, { source: 'en', target: 'el' }, {});
    expect(opened.sourceCode).toBe('en');
    expect(opened.targetCode).toBe('el');
    expect(opened.title).toBe('Translate en → el');
    const again = translateRenderer.applyLiveOptions!(opened, { source: 'auto', target: 'de' }, {});
    expect(again.sourceCode).toBeNull();
    expect(again.targetCode).toBe('de');
    expect(again.title).toBe('Translate → de');
  });

  it('keeps the legacy targetCode option and the auto source fallback', () => {
    const opened = translateRenderer.applyOpenOptions!(base, { targetCode: 'FR' }, {});
    expect(opened.targetCode).toBe('fr');
    expect(opened.sourceCode).toBeNull();
  });

  it('refuses a live update for a pack with no apply hook (honest degrade)', () => {
    setSurfacePackViews([calcView()], true);
    const calcEntry: CommandEntry = {
      id: 'calc:evaluate',
      kind: 'builtin',
      title: 'Calculator',
      category: 'tools',
      aliases: ['calc'],
      slash: 'calc',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'calc:evaluate',
    };
    const current: MiniApp = { ...base, id: 'calc:evaluate', packId: 'mini-calc', title: 'Calculator' };
    expect(miniAppForLiveOptions(calcEntry, current, {})).toBeNull();
  });

  it('applies live options through the pack-gated seam without remounting identity', () => {
    setSurfacePackViews([translateView()], true);
    const current = { ...base, targetCode: 'el', title: 'Translate → el' };
    const updated = miniAppForLiveOptions(translateEntry, current, { target: 'de' });
    expect(updated?.targetCode).toBe('de');
    expect(updated?.title).toBe('Translate → de');
  });
});
