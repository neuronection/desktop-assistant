// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import { SettingsApp } from '@renderer/settings-react/SettingsApp';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { MiniAppView, MiniAppsState, MiniAppRunEventPayload, MiniAppRunReportView } from '@shared/app-pack';

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
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

const PACK_ID = 'file-deletion-review';
const RUN_ID = 'run-9';

const pack: MiniAppView = {
  id: PACK_ID,
  version: '0.1.0',
  kind: 'assessment',
  title: 'Deletion review',
  description: 'Fixture pack',
  capabilities: ['fs-read', 'decision', 'run', 'report'],
  enabled: true,
  originKind: 'bundled',
  configFields: [],
  configValues: {},
};

const state: MiniAppsState = { masterEnabled: true, packs: [pack], removedBundled: [] };

const report: MiniAppRunReportView = {
  packTitle: 'Deletion review',
  run: {
    id: RUN_ID,
    packId: PACK_ID,
    packVersion: '0.1.0',
    rootPath: '/home/tester/demo',
    status: 'done',
    totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 },
    estimateCalls: 3,
    actualCalls: 3,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    conversationId: 'conv-1',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: 3,
  },
  items: [],
  reportNodes: [{ id: 'status', type: 'badge', bind: 'run.status' }],
  labels: {},
};

function baseApi(): Record<string, unknown> {
  return {
    loadConfig: vi.fn(async () => ({ ...DEFAULT_CONFIG }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getToolApps: vi.fn(async () => ({ apps: [], deferredSupported: false, nativeToolCount: 0 })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
    listToolAppPresets: vi.fn(async () => []),
    getMiniApps: vi.fn(async () => state),
    getMiniAppSources: async () => ({ sources: [], installs: [] }),
    importMiniApp: vi.fn(async () => ({ ok: true, view: pack })),
    removeMiniApp: vi.fn(async () => true),
    setMiniAppEnabled: vi.fn(async () => ({ ok: true })),
    saveMiniAppConfig: vi.fn(async () => ({ ok: true, values: {} })),
    openFile: vi.fn(async () => null),
    listMiniAppRuns: vi.fn(async () => [
      {
        id: RUN_ID,
        packId: PACK_ID,
        packVersion: '0.1.0',
        rootPath: '/home/tester/demo',
        status: 'done',
        totals: { scanned: 4, keep: 1, ask: 2, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 },
        estimateCalls: 3,
        actualCalls: 3,
        inputTokens: 0,
        outputTokens: 0,
        error: null,
        conversationId: 'conv-1',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
      },
    ]),
    onMiniAppRunEvent: vi.fn(() => () => {}),
    listMiniAppQuarantine: vi.fn(async () => ({ packId: PACK_ID, records: [] })),
    listMiniAppFeedback: vi.fn(async () => []),
    clearMiniAppFeedback: vi.fn(async () => 0),
    miniAppRunReport: vi.fn(async () => report),
    exportMiniAppRun: vi.fn(async () => ({ ok: true, text: 'x', fileName: 'x.md' })),
    saveFile: vi.fn(async () => ({ success: true })),
  };
}

describe('mini-app report deep-link (plan 27 S2)', () => {
  it('AppsTab: a miniAppRunFocus routes to the mini-apps view and pre-opens the run report', async () => {
    mockApiWith(baseApi());
    render(<AppsTab miniAppRunFocus={{ packId: PACK_ID, runId: RUN_ID, at: 1 }} />);

    await screen.findByText('Deletion review');
    expect(await screen.findByText('Deletion review — report')).toBeTruthy();
    expect(window.electronAPI.miniAppRunReport).toHaveBeenCalledWith(RUN_ID);
  });

  it('SettingsApp: the settings:navigate push drives the full round trip', async () => {
    const api = baseApi();
    const navigateListeners: Array<(target: unknown) => void> = [];
    api.getAppVersion = vi.fn(async () => '0.0.0-test');
    api.getHotkeySettings = vi.fn(async () => ({ hotkeys: [] }));
    api.onSettingsNavigate = vi.fn((callback: (target: unknown) => void) => {
      navigateListeners.push(callback);
      return () => {
        const index = navigateListeners.indexOf(callback);
        if (index >= 0) navigateListeners.splice(index, 1);
      };
    });
    mockApiWith(api);
    render(<SettingsApp onThemeChange={vi.fn()} />);
    await screen.findByRole('textbox', { hidden: true }).catch(() => undefined);

    navigateListeners.forEach((listener) => listener({ tab: 'apps', miniAppsReportPackId: PACK_ID, miniAppsReportRunId: RUN_ID }));
    expect(await screen.findByText('Deletion review — report')).toBeTruthy();
    expect((window.electronAPI.miniAppRunReport as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([RUN_ID]);
  });

  it('launcher: a run:finished notice carries a View report action that deep-links into settings', async () => {
    const api = baseApi();
    const runListeners: Array<(event: MiniAppRunEventPayload) => void> = [];
    api.onMiniAppRunEvent = vi.fn((callback: (event: MiniAppRunEventPayload) => void) => {
      runListeners.push(callback);
      return () => {
        const index = runListeners.indexOf(callback);
        if (index >= 0) runListeners.splice(index, 1);
      };
    });
    api.onSettingsOpen = vi.fn(async () => {});
    api.onLauncherToggleExpand = vi.fn(() => () => {});
    api.getConversationById = vi.fn(async () => null);
    api.getAllConversations = vi.fn(async () => []);
    api.onTurnEvent = vi.fn(() => () => {});
    api.startTurn = vi.fn(async () => 'turn_1');
    api.cancelTurn = vi.fn(async () => {});
    api.resumeTurn = vi.fn(async () => true);
    api.resizeWindow = vi.fn();
    api.hideWindow = vi.fn();
    api.openDesktop = vi.fn(async () => {});
    mockApiWith(api);

    render(<ChatApp onThemeChange={vi.fn()} />);
    await waitFor(() => expect(runListeners.length).toBeGreaterThan(0));

    runListeners.forEach((listener) => listener({ type: 'run:finished', runId: RUN_ID, packId: PACK_ID, status: 'done' }));
    expect(await screen.findByText('Mini-app run finished')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View report' }));
    await waitFor(() => {
      expect(window.electronAPI.onSettingsOpen).toHaveBeenCalledWith({ tab: 'apps', miniAppsReportPackId: PACK_ID, miniAppsReportRunId: RUN_ID });
    });
  });
});

function mockApiWith(api: Record<string, unknown>): void {
  window.electronAPI = api as unknown as typeof window.electronAPI;
}
