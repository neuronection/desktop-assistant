// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

function mockApi(overrides: { apps?: ToolAppView[]; deferredSupported?: boolean; config?: AppConfig } = {}) {
  const api = {
    getToolApps: vi.fn(async () => ({ apps: overrides.apps ?? [appView()], deferredSupported: overrides.deferredSupported ?? false })),
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
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByRole('radio', { name: /deferred behind provider tool search/i })).toBeTruthy();
  });

  it('previews a preset (risks + notes) and saves it with presetId + token header', async () => {
    const api = mockApi();
    render(<AppsTab />);
    fireEvent.click(await screen.findByRole('button', { name: /add home assistant/i }));
    expect(await screen.findByText(/permissions this app will request/i)).toBeTruthy();
    expect(screen.getByText('state-changing')).toBeTruthy();
    expect(screen.getByText(/usage guidance shipped with this preset/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/long-lived access token/i), { target: { value: 'TOKEN-VALUE' } });
    fireEvent.click(screen.getByRole('button', { name: /add app/i }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: /add rule/i }));
    fireEvent.change(screen.getAllByLabelText(/pattern/i)[0], { target: { value: 'lock.*' } });
    fireEvent.click(screen.getAllByRole('button', { name: /device scope/i })[0]);
    await waitFor(() =>
      expect(api.setToolAppEntityScope).toHaveBeenCalledWith('app-1', { rules: [{ effect: 'deny', pattern: 'lock.*' }] })
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh preview/i }));
    await waitFor(() => expect(api.previewToolAppScope).toHaveBeenCalledWith('app-1', [{ effect: 'deny', pattern: 'lock.*' }]));
    expect(await screen.findByText('light.kitchen')).toBeTruthy();
    expect(screen.getByText('lock.front_door')).toBeTruthy();
    expect(screen.getByText(/blocked/i)).toBeTruthy();
  });

  it('budget card shows bound count, warns over budget, and saves the budget', async () => {
    const api = mockApi({ config: { toolApps: { masterEnabled: true, apps: [], toolBudget: 1 } } as unknown as AppConfig });
    render(<AppsTab />);
    expect(await screen.findByText(/2 app tools currently bound/i)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Over budget');
    const input = screen.getByLabelText('Budget');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const payload = api.saveConfig.mock.calls[0][0];
    expect(payload.toolApps.toolBudget).toBe(30);
  });

  it('shows the English-first matching help copy (D17)', async () => {
    mockApi();
    render(<AppsTab />);
    expect(await screen.findByText(/compares English keywords/i)).toBeTruthy();
  });
});
