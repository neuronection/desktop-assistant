// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import axe from 'axe-core';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import type { MiniAppView, MiniAppsState } from '@shared/app-pack';

afterEach(cleanup);

const pack: MiniAppView = {
  id: 'sample-review',
  version: '0.1.0',
  kind: 'assessment',
  title: 'Sample review',
  description: 'Fixture pack for the scan',
  capabilities: ['fs-read', 'decision', 'run', 'report'],
  enabled: true,
  originKind: 'imported',
  importedAt: 1_700_000_000_000,
  configFields: [
    { name: 'freshDays', label: 'Keep files modified within (days)', type: 'number', default: 7, minimum: 0, maximum: 365 },
    { name: 'mode', type: 'string', enum: ['conservative', 'balanced'], default: 'conservative' },
    { name: 'dryRun', type: 'boolean', default: true },
    { name: 'exceptions', type: 'array', default: [] },
  ],
  configValues: { freshDays: 14 },
};

const brokenPack: MiniAppView = {
  ...pack,
  id: 'broken-pack',
  title: 'Broken pack',
  enabled: false,
  error: '$.apiVersion: requires host apiVersion >= 3',
  configFields: [],
  configValues: {},
};

function mockApi(state: MiniAppsState): void {
  window.electronAPI = {
    loadConfig: vi.fn(async () => ({ toolApps: { masterEnabled: true, apps: [], toolBudget: 25 } })),
    getToolApps: vi.fn(async () => ({ apps: [], deferredSupported: false, nativeToolCount: 0 })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
    listToolAppPresets: vi.fn(async () => []),
    getMiniApps: vi.fn(async () => state),
    importMiniApp: vi.fn(async () => ({ ok: true, view: pack })),
    removeMiniApp: vi.fn(async () => true),
    setMiniAppEnabled: vi.fn(async () => ({ ok: true })),
    saveMiniAppConfig: vi.fn(async () => ({ ok: true, values: {} })),
    openFile: vi.fn(async () => null),
    listMiniAppRuns: vi.fn(async () => [
      {
        id: 'run-1',
        packId: 'sample-review',
        packVersion: '0.1.0',
        rootPath: '/home/tester/projects/demo',
        status: 'done',
        totals: { scanned: 10, keep: 4, ask: 3, candidate: 3, ruleDecided: 6, modelDecided: 4, cacheHits: 0, pending: 0 },
        estimateCalls: 4,
        actualCalls: 4,
        inputTokens: 200,
        outputTokens: 90,
        error: null,
        conversationId: 'conv-1',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 3,
      },
      {
        id: 'run-2',
        packId: 'sample-review',
        packVersion: '0.1.0',
        rootPath: '/home/tester/projects/demo',
        status: 'paused',
        totals: { scanned: 10, keep: 0, ask: 4, candidate: 0, ruleDecided: 0, modelDecided: 1, cacheHits: 0, pending: 3 },
        estimateCalls: 4,
        actualCalls: 1,
        inputTokens: 50,
        outputTokens: 10,
        error: null,
        conversationId: 'conv-2',
        startedAt: 1,
        updatedAt: 2,
        finishedAt: null,
      },
    ]),
    pickMiniAppRoot: vi.fn(async () => ({ ok: false, error: 'cancelled' })),
    startMiniAppRun: vi.fn(async () => ({ ok: true, runId: 'run-3' })),
    cancelMiniAppRun: vi.fn(async () => ({ ok: true })),
    resumeMiniAppRun: vi.fn(async () => ({ ok: true })),
    miniAppRunReport: vi.fn(async () => null),
    exportMiniAppRun: vi.fn(async () => ({ ok: true, text: 'x', fileName: 'x.md' })),
    diffMiniAppRun: vi.fn(async () => ({ runId: 'run-1', baselineRunId: null, entries: [] })),
    saveFile: vi.fn(async () => null),
    listMiniAppQuarantine: vi.fn(async () => ({ packId: 'sample-review', records: [] })),
    listMiniAppFeedback: vi.fn(async () => []),
    clearMiniAppFeedback: vi.fn(async () => 0),
    restoreMiniAppQuarantineRecord: vi.fn(async () => ({ ok: true, restoredPath: '/x' })),
    emptyMiniAppQuarantine: vi.fn(async () => ({ ok: true, removed: 0 })),
    onMiniAppRunEvent: vi.fn(() => () => undefined),
    restoreBundledMiniApps: vi.fn(async () => ({ ok: true, installed: [] })),
  } as unknown as typeof window.electronAPI;
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

async function openMiniAppsView() {
  const { container } = render(<AppsTab />);
  const tabs = await screen.findByRole('tablist', { name: /^Apps$/ });
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Mini-apps' }));
  await screen.findByRole('tabpanel', { name: 'Mini-apps' });
  return container;
}

describe('AppsTab mini-apps view axe scans (plan 26 S1)', () => {
  it('renders the empty state with no violations', async () => {
    mockApi({ masterEnabled: true, packs: [] });
    const container = await openMiniAppsView();
    expect(screen.getByText('No mini-app packs installed')).toBeTruthy();
    await scanNoViolations(container);
  });

  it('renders installed packs (config form, capability badges, self-disable reason) with no violations', async () => {
    mockApi({ masterEnabled: true, packs: [pack, brokenPack] });
    const container = await openMiniAppsView();
    expect(screen.getByText('Sample review')).toBeTruthy();
    expect(screen.getByText(/Disabled — /)).toBeTruthy();
    expect(screen.getByLabelText('Keep files modified within (days)')).toBeTruthy();
    await scanNoViolations(container);
  });

  it('renders the runs area (history rows, cost, pending, actions) with no violations', async () => {
    mockApi({ masterEnabled: true, packs: [pack] });
    const container = await openMiniAppsView();
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.getByText(/Paused/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resume run/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Export Markdown/ }).length).toBeGreaterThan(0);
    await scanNoViolations(container);
  });

  it('renders pre-installed surface packs as configurable cards with no violations', async () => {
    const surfacePack: MiniAppView = {
      id: 'mini-translate',
      version: '1.1.0',
      kind: 'surface',
      title: 'Translate pad',
      description: 'Live translation pad (palette: /tr).',
      capabilities: ['ui', 'llm'],
      enabled: true,
      originKind: 'bundled',
      configFields: [
        { name: 'padDebounceMs', label: 'Auto-translate delay (ms)', type: 'number', default: 1500, minimum: 0, maximum: 5000 },
      ],
      configValues: { padDebounceMs: 1500 },
    };
    mockApi({ masterEnabled: true, packs: [pack, surfacePack] });
    const container = await openMiniAppsView();
    expect(await screen.findByText('Translate pad')).toBeTruthy();
    expect(screen.getByText(/Pre-installed surfaces/)).toBeTruthy();
    expect(screen.getByLabelText('Auto-translate delay (ms)')).toBeTruthy();
    await scanNoViolations(container);
  });

  it('renders the remove confirmation modal with no violations', async () => {
    mockApi({ masterEnabled: true, packs: [pack] });
    const container = await openMiniAppsView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByText('Remove mini-app pack');
    await scanNoViolations(container);
  });
});
