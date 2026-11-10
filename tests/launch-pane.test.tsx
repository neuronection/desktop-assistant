// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { LaunchPane } from '@renderer/shared/LaunchPane';
import { liveOptionValuesFor, miniAppForLiveOptions, optionsFooterFor, swapOptionsFor, type MiniApp } from '@renderer/chat-react/miniApps';
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
    configFields: [
      { name: 'sourceCode', type: 'string', default: 'auto' },
      { name: 'targetCode', type: 'string', default: 'en' },
      { name: 'engineMode', type: 'string', default: 'inherit', enum: ['inherit', 'auto', 'service', 'llm'] },
    ],
    configValues: { padDebounceMs: 1500, sourceCode: 'auto', targetCode: 'el' },
    launchOptions: [
      {
        id: 'source',
        label: 'Source',
        type: 'select',
        configKey: 'sourceCode',
        vocabulary: { vocabulary: 'languages', withAuto: true, allowCustom: true },
      },
      {
        id: 'target',
        label: 'Target',
        type: 'select',
        configKey: 'targetCode',
        vocabulary: { vocabulary: 'languages', allowCustom: true },
      },
      {
        id: 'engine',
        label: 'Engine',
        type: 'select',
        configKey: 'engineMode',
        choices: [
          { value: 'inherit', label: 'Configured default' },
          { value: 'auto', label: 'Services, then model' },
          { value: 'service', label: 'Service providers only' },
          { value: 'llm', label: 'Model only' },
        ],
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
      beta: true,
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
  recent: [],
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

describe('ChatApp — palette launch pane (plan 53 S3.1–S3.3; plan 68)', () => {
  it('opens a surface pack straight into its pad, seeded from the remembered/default direction', async () => {
    const api = mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    const chip = await screen.findByTestId('mini-app-options');
    expect(screen.queryByTestId('launch-pane')).toBeNull();
    expect(screen.getByText('Translate')).toBeTruthy();
    expect(screen.getByText('→ el')).toBeTruthy();
    expect(chip.textContent).toContain('Settings');
    expect(api.executeCommand).not.toHaveBeenCalled();
    expect(api.saveMiniAppConfig).not.toHaveBeenCalled();
  });

  it('Escape from a required-input pane steps back to the palette list with the query preserved', async () => {
    mockChatApi();
    const textarea = await openPaletteWith('file-deletion-review');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByTestId('launch-pane');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(textarea.value).toBe('/file-deletion-review');
    expect(document.activeElement).toBe(textarea);
  });

  it('tags a beta pack in the palette', async () => {
    mockChatApi();
    await openPaletteWith('file-deletion-review');
    expect(screen.getByTestId('palette-beta').textContent).toContain('Beta');
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

  it('offers Apply + Close and the family language browser instead of a Configure action', async () => {
    mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('mini-app-options'));
    await screen.findByTestId('launch-pane');
    expect(screen.getByTestId('launch-primary').textContent).toBe('Apply');
    expect(screen.getByTestId('launch-secondary').textContent).toBe('Close');
    expect(screen.queryByTestId('launch-configure')).toBeNull();
    fireEvent.click(screen.getByTestId('launch-option-target-trigger'));
    expect(screen.getByTestId('launch-option-target-option-el').textContent).toContain('🇬🇷');
    expect(screen.getByTestId('launch-option-target-option-el').textContent).toContain('Greek');
    fireEvent.click(screen.getByTestId('launch-secondary'));
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    expect(screen.getByTestId('mini-app-options')).toBeTruthy();
  });

  it('reopening the pad in the same session uses the applied direction', async () => {
    const api = mockChatApi();
    let views = [translateView(), reviewView(), calcView()];
    api.getMiniApps = vi.fn(async () => ({ masterEnabled: true, packs: views, removedBundled: [] }));
    api.saveMiniAppConfig = vi.fn(async (id: string, values: Record<string, unknown>) => {
      views = views.map((view) => (view.id === id ? { ...view, configValues: { ...view.configValues, ...values } } : view));
      return { ok: true, values };
    });
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    await screen.findByText('→ el');
    fireEvent.click(screen.getByTestId('mini-app-options'));
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-option-target-trigger'));
    fireEvent.click(screen.getByTestId('launch-option-target-option-de'));
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    await waitFor(() => expect(screen.getByText('→ de')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('mini-app-options')).toBeNull());
    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '/translate' } });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(await screen.findByText('→ de')).toBeTruthy();
  });

  it('links to the translation engine settings from the pad menu', async () => {
    const api = mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('mini-app-options'));
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-footer-link'));
    await waitFor(() => expect(api.onSettingsOpen).toHaveBeenCalledWith({ tab: 'tools', section: 'translation' }));
  });

  it('Escape from the Settings pane returns to the live pad with the typed text intact', async () => {
    mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    const input = (await screen.findByPlaceholderText(/Type text to translate/i)) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    const chip = await screen.findByTestId('mini-app-options');
    fireEvent.click(chip);
    await screen.findByTestId('launch-pane');
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('launch-pane')).toBeNull());
    expect((screen.getByPlaceholderText(/Type text to translate/i) as HTMLTextAreaElement).value).toBe('hello');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('mid-session: the Settings control reopens the menu pre-filled; Apply updates the live pad', async () => {
    const api = mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    const chip = await screen.findByTestId('mini-app-options');
    expect(screen.getByText('→ el')).toBeTruthy();
    fireEvent.click(chip);
    await screen.findByTestId('launch-pane');
    expect(screen.getByTestId('launch-primary').textContent).toBe('Apply');
    fireEvent.click(screen.getByTestId('launch-option-target-trigger'));
    fireEvent.click(screen.getByTestId('launch-option-target-option-de'));
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect(screen.getByText('→ de')).toBeTruthy());
    expect(screen.queryByTestId('launch-pane')).toBeNull();
    expect(api.saveMiniAppConfig).toHaveBeenCalledWith('mini-translate', expect.objectContaining({ targetCode: 'de' }));
  });
});

describe('pad settings pane — language browser (plan 69)', () => {
  it('is axe-clean with the picker open and the engine row rendered', { timeout: 30_000 }, async () => {
    mockChatApi();
    await openPaletteWith('translate');
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('mini-app-options'));
    await screen.findByTestId('launch-pane');
    fireEvent.click(screen.getByTestId('launch-option-target-trigger'));
    const results = await axe.run(screen.getByTestId('launch-pane'));
    expect(results.violations.map((violation) => violation.id).join(',')).toBe('');
  });
});

describe('translate binding — launch options (plan 53 S3.4; plan 68 seeding)', () => {
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
  const noConfig = { packConfig: {}, config: null };

  it('seeds an automatic source and the engine default, and keeps the pack name for chrome', () => {
    const opened = translateRenderer.applyOpenOptions!(base, {}, noConfig);
    expect(opened.sourceCode).toBeNull();
    expect(opened.targetCode).toBe('en');
    expect(opened.route).toBe('→ en');
    expect(opened.title).toBe('Translate');
  });

  it('follows the app translation default before the engine fallback', () => {
    const config = { ...DEFAULT_CONFIG, translation: { ...DEFAULT_CONFIG.translation, defaultTarget: 'el' } };
    const opened = translateRenderer.applyOpenOptions!(base, {}, { packConfig: {}, config });
    expect(opened.targetCode).toBe('el');
  });

  it('maps explicit source/target options onto the route, above the remembered choice', () => {
    const remembered = translateRenderer.applyOpenOptions!(base, {}, { packConfig: { sourceCode: 'auto', targetCode: 'fr' }, config: null });
    expect(remembered.targetCode).toBe('fr');
    expect(remembered.route).toBe('→ fr');
    const opened = translateRenderer.applyOpenOptions!(base, { source: 'en', target: 'el' }, { packConfig: { targetCode: 'fr' }, config: null });
    expect(opened.sourceCode).toBe('en');
    expect(opened.targetCode).toBe('el');
    expect(opened.route).toBe('en → el');
    expect(opened.title).toBe('Translate');
    const again = translateRenderer.applyLiveOptions!(opened, { source: 'auto', target: 'de' }, noConfig);
    expect(again.sourceCode).toBeNull();
    expect(again.targetCode).toBe('de');
    expect(again.route).toBe('→ de');
  });

  it('prefers the remembered pack choice over the app default', () => {
    const config = { ...DEFAULT_CONFIG, translation: { ...DEFAULT_CONFIG.translation, defaultTarget: 'el' } };
    const opened = translateRenderer.applyOpenOptions!(base, {}, { packConfig: { sourceCode: 'de', targetCode: 'fr' }, config });
    expect(opened.targetCode).toBe('fr');
    expect(opened.sourceCode).toBe('de');
    expect(opened.route).toBe('de → fr');
  });

  it('keeps the legacy targetCode option and the auto source fallback', () => {
    const opened = translateRenderer.applyOpenOptions!(base, { targetCode: 'FR' }, noConfig);
    expect(opened.targetCode).toBe('fr');
    expect(opened.sourceCode).toBeNull();
  });

  it('describes the mirror direction for a one-click swap, and nothing for automatic sources', () => {
    setSurfacePackViews([translateView()], true);
    expect(swapOptionsFor({ ...base, sourceCode: 'en', targetCode: 'el' })).toEqual({ source: 'el', target: 'en' });
    expect(swapOptionsFor({ ...base, sourceCode: null, targetCode: 'el' })).toBeNull();
    expect(liveOptionValuesFor({ ...base, sourceCode: 'en', targetCode: 'el', engineMode: null })).toEqual({
      source: 'en',
      target: 'el',
      engine: 'inherit',
    });
    expect(optionsFooterFor(base)?.label).toContain('engine settings');
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
    const current = { ...base, targetCode: 'el', route: '→ el' };
    const updated = miniAppForLiveOptions(translateEntry, current, { target: 'de' });
    expect(updated?.targetCode).toBe('de');
    expect(updated?.route).toBe('→ de');
  });
});
