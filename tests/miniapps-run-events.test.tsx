// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import type { MiniAppRunEventPayload, MiniAppRunView, MiniAppView, MiniAppsState } from '@shared/app-pack';

afterEach(cleanup);

const pack: MiniAppView = {
  id: 'sample-review',
  version: '0.1.0',
  kind: 'assessment',
  title: 'Sample review',
  capabilities: ['fs-read', 'decision', 'run', 'report'],
  enabled: true,
  originKind: 'imported',
  configFields: [],
  configValues: {},
};

function runRow(overrides: Partial<MiniAppRunView>): MiniAppRunView {
  return {
    id: 'run-1',
    packId: 'sample-review',
    packVersion: '0.1.0',
    rootPath: '/home/tester/projects/demo',
    status: 'running',
    totals: null,
    estimateCalls: 0,
    actualCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    conversationId: 'conv-1',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: null,
    ...overrides,
  };
}

let runEventListener: ((event: MiniAppRunEventPayload) => void) | null = null;
const runs = [runRow({})];

function mockApi(): void {
  runEventListener = null;
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ toolApps: { masterEnabled: true, apps: [], toolBudget: 25 } })),
    getToolApps: vi.fn(async () => ({ apps: [], deferredSupported: false, nativeToolCount: 0 })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
    listToolAppPresets: vi.fn(async () => []),
    getMiniApps: vi.fn(async (): MiniAppsState => ({ masterEnabled: true, packs: [pack] })),
    importMiniApp: vi.fn(async () => ({ ok: true, view: pack })),
    removeMiniApp: vi.fn(async () => true),
    setMiniAppEnabled: vi.fn(async () => ({ ok: true })),
    saveMiniAppConfig: vi.fn(async () => ({ ok: true, values: {} })),
    openFile: vi.fn(async () => null),
    listMiniAppRuns: vi.fn(async () => [...runs]),
    pickMiniAppRoot: vi.fn(async () => ({ ok: true, root: '/home/tester/projects/demo' })),
    startMiniAppRun: vi.fn(async () => ({ ok: true, runId: 'run-1' })),
    cancelMiniAppRun: vi.fn(async () => ({ ok: true })),
    resumeMiniAppRun: vi.fn(async () => ({ ok: true })),
    miniAppRunReport: vi.fn(async () => null),
    exportMiniAppRun: vi.fn(async () => ({ ok: true, text: 'x', fileName: 'x.md' })),
    diffMiniAppRun: vi.fn(async () => ({ runId: 'run-1', baselineRunId: null, entries: [] })),
    saveFile: vi.fn(async () => null),
    onMiniAppRunEvent: (callback: (event: MiniAppRunEventPayload) => void) => {
      runEventListener = callback;
      return () => {
        runEventListener = null;
      };
    },
  } as unknown as typeof window.electronAPI;
}

async function openMiniAppsView() {
  const { container } = render(<AppsTab />);
  const tabs = await screen.findByRole('tablist', { name: /MCP servers/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Mini-apps' }));
  await screen.findByRole('tabpanel', { name: 'Mini-apps' });
  await screen.findByText('Sample review');
  return container;
}

function fire(event: MiniAppRunEventPayload): void {
  runEventListener?.(event);
}

describe('mini-app run surfaces — the real run:* event sequence (plan 26 S4)', () => {
  it('renders live estimate + progress from run:started → run:progress, then settles on run:finished', async () => {
    mockApi();
    await openMiniAppsView();
    expect(await screen.findByText('Running')).toBeTruthy();

    fire({ type: 'run:started', runId: 'run-1', packId: 'sample-review', status: 'running' });
    fire({ type: 'run:progress', runId: 'run-1', packId: 'sample-review', estimateCalls: 12 });
    expect(await screen.findByText('≈ 12 model calls')).toBeTruthy();
    fire({ type: 'run:progress', runId: 'run-1', packId: 'sample-review', phase: 'decide', done: 3, total: 12 });
    expect(await screen.findByText(/3 of 12/)).toBeTruthy();
    fire({ type: 'run:item', runId: 'run-1', packId: 'sample-review', relPath: 'a.log', verdict: 'candidate', decidedBy: 'engine:llm' });
    fire({ type: 'run:paused', runId: 'run-1', packId: 'sample-review', status: 'paused' });

    runs[0] = runRow({ status: 'paused', estimateCalls: 12, actualCalls: 3, totals: { scanned: 12, keep: 0, ask: 9, candidate: 0, ruleDecided: 0, modelDecided: 0, cacheHits: 0, pending: 9 } });
    fire({ type: 'run:resumed', runId: 'run-1', packId: 'sample-review', status: 'running' });
    runs[0] = runRow({ status: 'done', estimateCalls: 12, actualCalls: 12, totals: { scanned: 12, keep: 2, ask: 7, candidate: 3, ruleDecided: 2, modelDecided: 10, cacheHits: 0, pending: 0 } });
    fire({ type: 'run:finished', runId: 'run-1', packId: 'sample-review', status: 'done' });

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy();
    });
  });

  it('exposes resume for paused runs through the same event flow', async () => {
    mockApi();
    runs[0] = runRow({ status: 'paused', totals: { scanned: 5, keep: 0, ask: 2, candidate: 0, ruleDecided: 0, modelDecided: 0, cacheHits: 0, pending: 3 } });
    await openMiniAppsView();
    const resume = screen.getByRole('button', { name: /Resume run/ });
    fireEvent.click(resume);
    await waitFor(() => {
      expect(window.electronAPI.resumeMiniAppRun).toHaveBeenCalledWith('run-1');
    });
  });
});
