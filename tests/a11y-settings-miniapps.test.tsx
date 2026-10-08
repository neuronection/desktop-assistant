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
    { name: 'freshDays', type: 'number', default: 7, minimum: 0, maximum: 365 },
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
  const tabs = await screen.findByRole('tablist', { name: /MCP servers/ });
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
    expect(screen.getByLabelText('config.freshDays')).toBeTruthy();
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
