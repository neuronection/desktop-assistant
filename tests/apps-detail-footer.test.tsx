// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import { APP_PRESETS } from '@shared/app-presets';
import type { ToolAppView } from '@shared/apps';
import type { AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

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
      { name: 'mcp__homeassistant__list_devices', state: { enabled: true, keywordTags: [], baseRisk: 'read-only', entityRole: 'discovery' } },
    ],
    ...overrides,
  };
}

function baseConfig(): AppConfig {
  return { toolApps: { masterEnabled: true, apps: [], toolBudget: 25 } } as unknown as AppConfig;
}

function mockApi(apps?: ToolAppView[]): ReturnType<typeof vi.fn> & never[] {
  const api = {
    getToolApps: vi.fn(async () => ({ apps: apps ?? [appView()], deferredSupported: false, nativeToolCount: 6 })),
    getToolAppDigestStats: vi.fn(async () => ({ 'app-1': { entities: 42, ageMinutes: 0 } })),
    listToolAppPresets: vi.fn(async () => APP_PRESETS),
    loadConfig: vi.fn(async () => baseConfig()),
    saveConfig: vi.fn(async () => undefined),
    setToolAppEnabled: vi.fn(async () => true),
    saveToolApp: vi.fn(async () => ({ ok: true, view: appView() })),
    removeToolApp: vi.fn(async () => true),
    setToolAppState: vi.fn(async () => true),
    setToolAppEntityScope: vi.fn(async () => true),
    testToolApp: vi.fn(async () => ({ ok: true, latencyMs: 42, toolCount: 5 })),
    previewToolAppScope: vi.fn(async () => ({ entities: [] })),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api as unknown as ReturnType<typeof vi.fn> & never[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

async function openDetail(apps?: ToolAppView[]): Promise<{ api: ReturnType<typeof vi.fn> & never[]; footer: HTMLElement }> {
  const api = mockApi(apps);
  render(<AppsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  await screen.findByRole('tab', { name: /connection/i });
  const save = await screen.findByRole('button', { name: 'Save' });
  const footer = save.parentElement as HTMLElement;
  return { api, footer };
}

describe('app detail modal footer', () => {
  it('always shows Close and Save in the footer', async () => {
    const { footer } = await openDetail();
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Close' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /tools/i }));
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(footer).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('one Save persists the connection and the directives together', async () => {
    const { api, footer } = await openDetail();
    fireEvent.change(await screen.findByLabelText('Server endpoint'), { target: { value: 'http://ha.local:8123/mcp' } });
    fireEvent.change(await screen.findByLabelText('Directives'), { target: { value: 'Prefer app tools.' } });
    fireEvent.click(within(footer).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalledTimes(1));
    const payload = api.saveToolApp.mock.calls[0][0];
    expect(payload.sources[0].server.transport.url).toBe('http://ha.local:8123/mcp');
    expect(payload.directives).toBe('Prefer app tools.');
  });

  it('saving directives never reverts an edited endpoint (single-write, no stale spread)', async () => {
    const { api, footer } = await openDetail();
    fireEvent.change(await screen.findByLabelText('Server endpoint'), { target: { value: 'http://new-host:9000/mcp' } });
    fireEvent.click(within(footer).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalledTimes(1));
    for (const call of api.saveToolApp.mock.calls) {
      expect(call[0].sources[0].server.transport.url).toBe('http://new-host:9000/mcp');
    }
  });

  it('shows the live-context digest readout in the detail modal (plan 23 S6)', async () => {
    await openDetail();
    expect(await screen.findByTestId('app-digest-readout')).toBeTruthy();
    expect(screen.getByTestId('app-digest-readout').textContent).toContain('42 entities');
  });

  it('the footer Close button dismisses the modal', async () => {
    const { footer } = await openDetail();
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /connection/i })).toBeNull());
  });

  it('saves directives for native-source apps (no connection editor)', async () => {
    const native = appView({
      app: {
        id: 'app-native',
        name: 'Native Tools',
        description: '',
        enabled: true,
        sources: [{ kind: 'native-group' as never }],
        toolState: {},
        exposure: 'relevance',
      },
    });
    const { api, footer } = await openDetail([native]);
    expect(screen.queryByLabelText('Server endpoint')).toBeNull();
    fireEvent.click(within(footer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveToolApp).toHaveBeenCalled());
    expect(screen.getAllByText(TEXT.APPS_SOURCE_NATIVE).length).toBeGreaterThan(0);
  });
});
