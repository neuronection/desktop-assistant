// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import { APP_PRESETS } from '@shared/app-presets';
import type { ToolAppView } from '@shared/apps';
import type { AppConfig } from '@shared/config/AppConfig';

function appView(overrides: Partial<ToolAppView> = {}): ToolAppView {
  return {
    app: {
      id: 'app-1',
      name: 'Home Assistant',
      description: 'Smart home control',
      enabled: true,
      sources: [
        {
          kind: 'mcp',
          server: {
            id: 'srv-1',
            name: 'homeassistant',
            transport: { type: 'http', url: 'http://homeassistant.local:8124/mcp' },
            enabled: true,
            defaultAction: 'allow',
          },
        },
      ],
      toolState: {},
      exposure: 'relevance',
    },
    status: { appId: 'app-1', state: 'connected', toolCount: 2, latencyMs: 12, lastError: null },
    envKeys: ['TOKEN'],
    headerKeys: [],
    knownTools: [
      { name: 'mcp__homeassistant__list_devices', state: { enabled: true, keywordTags: ['devices'], baseRisk: 'read-only', entityRole: 'discovery' } },
      { name: 'mcp__homeassistant__control', state: null },
    ],
    ...overrides,
  };
}

function baseConfig(): AppConfig {
  return {
    toolApps: { masterEnabled: true, apps: [], toolBudget: 25 },
  } as unknown as AppConfig;
}

function mockApi(overrides: { apps?: ToolAppView[]; deferredSupported?: boolean; config?: AppConfig; nativeToolCount?: number } = {}) {
  const api = {
    getToolApps: vi.fn(async () => ({
      apps: overrides.apps ?? [appView()],
      deferredSupported: overrides.deferredSupported ?? false,
      nativeToolCount: overrides.nativeToolCount ?? 6,
    })),
    listToolAppPresets: vi.fn(async () => APP_PRESETS),
    loadConfig: vi.fn(async () => overrides.config ?? baseConfig()),
    saveConfig: vi.fn(async () => undefined),
    setToolAppEnabled: vi.fn(async () => true),
    saveToolApp: vi.fn(async () => ({ ok: true, view: appView() })),
    removeToolApp: vi.fn(async () => true),
    setToolAppState: vi.fn(async () => true),
    setToolAppEntityScope: vi.fn(async () => true),
    testToolApp: vi.fn(async () => ({ ok: true, latencyMs: 42, toolCount: 5 })),
    previewToolAppScope: vi.fn(async () => ({
      entities: [
        { id: 'light.kitchen', allowed: true },
        { id: 'lock.front_door', allowed: false },
      ],
    })),
    getAppUsageStats: vi.fn(async () => ({
      windowDays: 30,
      total: 4,
      rows: [
        { app: 'Home Assistant', total: 4, ok: 3, errors: 1, denied: 0, avgDurationMs: 210, lastUsedAt: new Date().toISOString() },
      ],
    })),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AppsTab (plan 15 S5)', () => {
  it('renders app rows with source and health chips, and filters by search', async () => {
    mockApi();
    render(<AppsTab />);
    expect(await screen.findByText('MCP')).toBeTruthy();
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText(/search apps/i), { target: { value: 'zzz' } });
    expect(screen.getByText(/no tool apps yet/i)).toBeTruthy();
  });

  it('toggles an app through setToolAppEnabled', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('switch', { name: /Home Assistant enabled/i }));
    await waitFor(() => expect(api.setToolAppEnabled).toHaveBeenCalledWith('app-1', false));
  });

  it('renders a self-disabled app error', async () => {
    mockApi({
      apps: [appView({ app: { ...appView().app, enabled: false, error: 'invalid manifest' } })],
    });
    render(<AppsTab />);
    expect((await screen.findByRole('alert')).textContent).toContain('invalid manifest');
  });

  it('toggles a tool in the detail modal and offers undo', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tools' }));
    const switchEl = await screen.findByRole('switch', { name: /list_devices enabled/i });
    fireEvent.click(switchEl);
    await waitFor(() => expect(api.setToolAppState).toHaveBeenCalledWith('app-1', 'mcp__homeassistant__list_devices', { enabled: false }));
    const undo = await screen.findByRole('button', { name: /undo/i });
    fireEvent.click(undo);
    await waitFor(() =>
      expect(api.setToolAppState).toHaveBeenLastCalledWith('app-1', 'mcp__homeassistant__list_devices', { enabled: true })
    );
  });

  it('hides deferred exposure without support and shows the reason; saves exposure changes', async () => {
    const api = mockApi({ deferredSupported: false });
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('radio', { name: /deferred behind provider tool search/i })).toBeNull();
    expect(screen.getByText(/deferred needs a model with server-side tool search/i)).toBeTruthy();

    fireEvent.click(await screen.findByRole('radio', { name: /always available/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.exposure).toBe('always');
  });

  it('shows the deferred exposure option when the model supports it', async () => {
    mockApi({ deferredSupported: true });
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('radio', { name: /deferred behind provider tool search/i })).toBeTruthy();
  });

  it('previews a preset (risks + notes) and saves it with presetId + token header', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add app/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/permissions this app will request/i)).toBeTruthy();
    expect(screen.getAllByText('state-changing').length).toBeGreaterThan(0);
    expect(screen.getByText(/usage guidance shipped with this preset/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/long-lived access token/i), { target: { value: 'TOKEN-VALUE' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.presetId).toBe('home-assistant');
    expect(payload.headers.Authorization).toBe('Bearer TOKEN-VALUE');
  });

  it('remove flow confirms that server config and secrets are deleted (D11)', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect((await screen.findByText(/its stored secrets/i)).textContent).toContain('cannot be undone');
    fireEvent.click(screen.getByRole('button', { name: /remove app/i }));
    await waitFor(() => expect(api.removeToolApp).toHaveBeenCalledWith('app-1'));
  });

  it('scope editor round-trips rules and renders the preview split (D18)', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Scope' }));
    fireEvent.click(await screen.findByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getAllByLabelText(/pattern/i)[0], { target: { value: 'lock.*' } });
    fireEvent.click(screen.getByRole('button', { name: /save rules/i }));
    await waitFor(() =>
      expect(api.setToolAppEntityScope).toHaveBeenCalledWith('app-1', { rules: [{ effect: 'deny', pattern: 'lock.*' }] })
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh preview/i }));
    await waitFor(() => expect(api.previewToolAppScope).toHaveBeenCalledWith('app-1', [{ effect: 'deny', pattern: 'lock.*' }]));
    expect(await screen.findByText('light.kitchen')).toBeTruthy();
    expect(screen.getByText('lock.front_door')).toBeTruthy();
    expect(screen.getByText(/blocked/i)).toBeTruthy();
  });

  it('budget card shows the engine total (native + apps), warns over budget, and saves the budget', async () => {
    const api = mockApi({ nativeToolCount: 6, config: { toolApps: { masterEnabled: true, apps: [], toolBudget: 5 } } as unknown as AppConfig });
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText(/8 tools currently bound/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Over budget');
    const input = screen.getByLabelText('Budget');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const payload = api.saveConfig.mock.calls[0][0];
    expect(payload.toolApps.toolBudget).toBe(30);
  });

  it('edits and saves standing directives from the detail modal', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText('Directives');
    fireEvent.change(field, { target: { value: 'Use app tools, never shell.' } });
    fireEvent.click(screen.getByRole('button', { name: /save directives/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.directives).toBe('Use app tools, never shell.');
  });

  it('adds a custom MCP app (HTTP + token) without a preset', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add app/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /custom mcp/i }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'My Server' } });
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://192.168.1.10:8123/mcp' } });
    fireEvent.change(screen.getByLabelText(/bearer token/i), { target: { value: 'TOKEN-1' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.sources[0].server.name).toBe('my-server');
    expect(payload.sources[0].server.transport).toEqual({ type: 'http', url: 'http://192.168.1.10:8123/mcp' });
    expect(payload.headers.Authorization).toBe('Bearer TOKEN-1');
  });

  it('adds a custom stdio app with command and args', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add app/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /custom mcp/i }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Files' } });
    fireEvent.change(screen.getByLabelText('Connection type'), { target: { value: 'stdio' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/usr/bin/npx' } });
    fireEvent.change(screen.getByLabelText(/arguments/i), { target: { value: '-y mcp-server-files' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.sources[0].server.transport).toEqual({ type: 'stdio', command: '/usr/bin/npx', args: ['-y', 'mcp-server-files'] });
  });

  it('edits allowlist, timeout and max-concurrency from the detail modal', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByLabelText(/tool allowlist/i), { target: { value: 'get_status, control' } });
    fireEvent.change(screen.getByLabelText(/tool timeout/i), { target: { value: '15000' } });
    fireEvent.change(screen.getByLabelText(/max concurrent calls/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /save connection/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const server = api.saveToolApp.mock.calls[0][0].sources[0].server;
    expect(server.allowlist).toEqual(['get_status', 'control']);
    expect(server.timeoutMs).toBe(15000);
    expect(server.maxConcurrent).toBe(2);
  });

  it('rejects invalid environment JSON without saving', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByText(/advanced server options/i));
    console.log('LABELS:', Array.from(document.querySelectorAll('label')).map((l) => l.textContent));
    fireEvent.change(screen.getByLabelText('Environment (JSON object of strings)'), { target: { value: '{not json' } });
    fireEvent.click(screen.getByRole('button', { name: /save connection/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('invalid JSON');
    expect(api.saveToolApp).not.toHaveBeenCalled();
  });

  it('custom app form accepts the full server option surface (allowlist, timeout, env)', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add app/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /custom mcp/i }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Full' } });
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://x/mcp' } });
    fireEvent.change(screen.getByLabelText(/tool allowlist/i), { target: { value: 'get_status, control' } });
    fireEvent.change(screen.getByLabelText(/tool timeout/i), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText(/max concurrent calls/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Environment (JSON object of strings)'), { target: { value: '{"KEY":"v"}' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    const payload = api.saveToolApp.mock.calls[0][0];
    const server = payload.sources[0].server;
    expect(server.allowlist).toEqual(['get_status', 'control']);
    expect(server.defaultAction).toBe('deny');
    expect(server.timeoutMs).toBe(12000);
    expect(server.maxConcurrent).toBe(3);
    expect(payload.env).toEqual({ KEY: 'v' });
  });

  it('rejects invalid env JSON in the add form without saving', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add app/i }));
    fireEvent.click(await screen.findByRole('tab', { name: /custom mcp/i }));
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Broken' } });
    fireEvent.change(screen.getByLabelText('Environment (JSON object of strings)'), { target: { value: 'nope' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add app/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.saveToolApp).not.toHaveBeenCalled();
  });

  it('runs a connection test from the app card and shows the result inline', async () => {
    mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/Connected · 42 ms · 5 tools/i)).toBeTruthy();
  });

  it('shows the English-first matching help copy in Settings (D17)', async () => {
    mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText(/compares English keywords/i)).toBeTruthy();
  });

  it('renders the app list as a two-column grid with an app icon from the pick', async () => {
    let current = appView();
    const api = mockApi();
    api.getToolApps.mockImplementation(async () => ({
      apps: [current],
      deferredSupported: false,
      nativeToolCount: 6,
    }));
    api.saveToolApp.mockImplementation(async (spec: ToolAppView['app']) => {
      current = { ...current, app: spec };
      return { ok: true, view: current };
    });
    render(<AppsTab />);
    const list = await screen.findByRole('list');
    expect(list.className).toContain('sm:grid-cols-2');
    expect(document.querySelector('.lucide-home')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const group = await screen.findByRole('group', { name: 'App icon' });
    fireEvent.click(within(group).getByRole('button', { name: 'home' }));
    expect(api.saveToolApp.mock.calls[0][0].icon).toBe('home');
    await waitFor(() => expect(screen.getByRole('button', { name: 'home', pressed: true })).toBeTruthy());
    expect(document.querySelector('.lucide-home')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'home' }));
    await waitFor(() => expect(api.saveToolApp.mock.calls[1][0].icon).toBeUndefined());
  });

  it('groups detail tools by risk tier and filters them by needle', async () => {
    mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Tools' }));
    expect(await screen.findByText('Read-only (1)')).toBeTruthy();
    expect(await screen.findByText('State-changing (1)')).toBeTruthy();

    fireEvent.change(await screen.findByPlaceholderText(/filter tools/i), { target: { value: 'devicezzz' } });
    expect(screen.queryByText(/list_devices enabled/i)).toBeNull();
    expect(screen.getByText(/No tools match the filter/i)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/filter tools/i), { target: { value: 'control' } });
    expect(null).not.toBe(screen.getByRole('switch', { name: /control enabled/i }));
    expect(screen.queryByRole('switch', { name: /list_devices enabled/i })).toBeNull();
  });

  it('shows per-app usage analytics in the settings sub-view', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText(/audited tool calls attributed per app/i)).toBeTruthy();
    expect(screen.getByText('Home Assistant')).toBeTruthy();
    expect(screen.getByRole('meter', { name: /Home Assistant: 4 calls/i })).toBeTruthy();
    expect(api.getAppUsageStats).toHaveBeenCalledWith(30);
  });
});

