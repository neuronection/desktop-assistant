// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppsTab } from '@renderer/settings-react/tabs/AppsTab';
import type { SettingsDetailRoute } from '@renderer/settings-react/apps/route';
import type { MiniAppView, MiniAppsState } from '@shared/app-pack';

const PACK_ID = 'sample-review';

function packView(overrides: Partial<MiniAppView> = {}): MiniAppView {
  return {
    id: PACK_ID,
    version: '0.1.0',
    kind: 'assessment',
    title: 'Sample review',
    description: 'Fixture pack',
    capabilities: ['fs-read', 'decision', 'run', 'report'],
    enabled: true,
    originKind: 'imported',
    importedAt: 1_700_000_000_000,
    configFields: [
      {
        name: 'freshDays',
        label: 'Keep files modified within (days)',
        description: 'Files modified within this many days are kept without review.',
        type: 'number',
        default: 7,
        minimum: 0,
        maximum: 365,
      },
    ],
    configValues: { freshDays: 14 },
    ...overrides,
  };
}

function runRow(id: string) {
  return {
    id,
    packId: PACK_ID,
    packVersion: '0.1.0',
    rootPath: '/home/tester/demo',
    status: 'done',
    totals: { scanned: 4, keep: 2, ask: 1, candidate: 1, ruleDecided: 3, modelDecided: 1, cacheHits: 0, pending: 0 },
    estimateCalls: 3,
    actualCalls: 3,
    inputTokens: 10,
    outputTokens: 5,
    error: null,
    conversationId: 'conv-1',
    startedAt: 1,
    updatedAt: 2,
    finishedAt: 3,
  };
}

function mockApi(state: () => MiniAppsState) {
  const api = {
    loadConfig: vi.fn(async () => ({ toolApps: { masterEnabled: true, apps: [], toolBudget: 25 } })),
    getToolApps: vi.fn(async () => ({ apps: [], deferredSupported: false, nativeToolCount: 0 })),
    getToolAppDigestStats: vi.fn(async () => ({})),
    getAppUsageStats: vi.fn(async () => ({ windowDays: 30, total: 0, rows: [] })),
    listToolAppPresets: vi.fn(async () => []),
    getMiniApps: vi.fn(async () => state()),
    getMiniAppHostProfile: vi.fn(async () => ({ t2Isolation: 'none' })),
    getMiniAppSources: async () => ({ sources: [], installs: [] }),
    importMiniApp: vi.fn(async () => ({ ok: true, view: packView() })),
    removeMiniApp: vi.fn(async () => true),
    setMiniAppEnabled: vi.fn(async () => ({ ok: true })),
    saveMiniAppConfig: vi.fn(async () => ({ ok: true, values: {} })),
    openFile: vi.fn(async () => null),
    openMiniAppWindow: vi.fn(async () => ({ ok: true, opened: true })),
    listMiniAppRuns: vi.fn(async () => [runRow('run-1')]),
    onMiniAppRunEvent: vi.fn(() => () => undefined),
    miniAppRunReport: vi.fn(async () => null),
    exportMiniAppRun: vi.fn(async () => ({ ok: true, text: 'x', fileName: 'x.md' })),
    diffMiniAppRun: vi.fn(async () => null),
    saveFile: vi.fn(async () => null),
    listMiniAppQuarantine: vi.fn(async () => ({ packId: PACK_ID, records: [] })),
    listMiniAppFeedback: vi.fn(async () => []),
    clearMiniAppFeedback: vi.fn(async () => 0),
    restoreBundledMiniApps: vi.fn(async () => ({ ok: true, installed: [] })),
    pickMiniAppRoot: vi.fn(async () => ({ ok: true, root: '/picked/folder' })),
  } as unknown as typeof window.electronAPI;
  window.electronAPI = api;
  return api;
}

const appsTabProps = {
  config: { toolApps: { masterEnabled: true, apps: [], toolBudget: 25 } } as never,
  updateConfig: vi.fn(),
};

async function openPacksHub() {
  render(<AppsTab {...appsTabProps} />);
  const tabs = await screen.findByRole('tablist', { name: /^Integrations$/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Packs' }));
  await screen.findByRole('tabpanel', { name: 'Mini-apps' });
}

afterEach(cleanup);

describe('mini-apps detail pages (plan 49 phase 1)', () => {
  it('keeps runs and configuration off the hub cards', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    expect(await screen.findByRole('button', { name: 'Configure Sample review' })).toBeTruthy();
    expect(screen.queryByLabelText('Keep files modified within (days)')).toBeNull();
    expect(screen.queryByText(/Resume run/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run…' })).toBeNull();
  });

  it('navigates card → config page → back to the hub with focus restored', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Sample review' }));
    expect(await screen.findByRole('region', { name: 'Pack settings — Sample review' })).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: /^Integrations$/ })).toBeNull();
    expect(screen.queryByRole('tabpanel', { name: 'Mini-apps' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('tabpanel', { name: 'Mini-apps' });
    expect(screen.getByRole('button', { name: 'Configure Sample review' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Configure Sample review' }))
    );
  });

  it('Restore defaults resets the edit state to the shipped preset (plan 55)', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Sample review' }));
    const field = await screen.findByLabelText('Keep files modified within (days)');
    fireEvent.change(field, { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('config-restore'));
    expect((await screen.findByLabelText('Keep files modified within (days)')) as HTMLInputElement).toBeTruthy();
    expect((screen.getByLabelText('Keep files modified within (days)') as HTMLInputElement).value).toBe('7');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect((window.electronAPI as Record<string, ReturnType<typeof vi.fn>>).saveMiniAppConfig).toHaveBeenCalledWith(PACK_ID, { freshDays: 7 }));
  });

  it('saves configuration from the config page', async () => {
    const api = mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Sample review' }));
    const field = await screen.findByLabelText('Keep files modified within (days)');
    fireEvent.change(field, { target: { value: '30' } });
    expect(screen.getByText('Files modified within this many days are kept without review.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.saveMiniAppConfig).toHaveBeenCalledWith(PACK_ID, { freshDays: 30 }));
  });

  it('navigates card → runs page with the run controls', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the runs for Sample review' }));
    expect(await screen.findByRole('region', { name: 'Runs — Sample review' })).toBeTruthy();
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run…' })).toBeTruthy();
  });

  it('Restore defaults populates the Policy editor from the shipped preset (plan 55 regression)', async () => {
    const manifest = JSON.parse(readFileSync(path.resolve(__dirname, '../src/packs/file-deletion-review/manifest.json'), 'utf8')) as Record<string, unknown>;
    const realPack: MiniAppView = {
      ...(packView() as unknown as MiniAppView),
      id: PACK_ID,
      version: String((manifest as { version: string }).version),
      configFields: Object.entries(
        ((manifest as { configSchema: { properties: Record<string, Record<string, unknown>> } }).configSchema.properties)
      ).map(([name, field]) => ({
        name,
        label: String(name),
        description: undefined,
        type: (field.type as 'string' | 'number' | 'boolean' | 'array'),
        enum: Array.isArray(field.enum) ? (field.enum as string[]) : undefined,
        default: field.default as string | number | boolean | string[] | undefined,
      })),
      configValues: {},
    };
    mockApi(() => ({ masterEnabled: true, packs: [realPack], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Sample review' }));
    await screen.findByRole('region', { name: 'Pack settings — Sample review' });
    fireEvent.click(screen.getByTestId('config-restore'));
    expect((await screen.findByTestId('policy-keep') as HTMLTextAreaElement).value).toContain('Anything user-created');
    expect((screen.getByTestId('policy-preview').textContent ?? '')).toContain('SCORING HINTS');
  });

  it('falls back to the native folder picker when the pack view cannot supply a run root (stale manifest)', async () => {
    const api = mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    (api as Record<string, unknown>).startMiniAppRun = vi.fn(async () => ({ ok: true, runId: 'run-2' }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the runs for Sample review' }));
    await screen.findByRole('region', { name: 'Runs — Sample review' });
    fireEvent.click(screen.getByTestId('run-launch'));
    await waitFor(() => expect(window.electronAPI.pickMiniAppRoot).toHaveBeenCalled());
    expect(screen.queryByTestId('pack-launch-menu')).toBeNull();
  });

  it('opens the shared launch menu from Run…, persists the options and starts with the chosen folder (plan 53 S3.4)', async () => {
    const launchPack = packView({
      launchOptions: [
        { id: 'root', label: 'Folder', type: 'path', required: true },
        { id: 'read-context', label: 'Read context', type: 'switch', configKey: 'freshDays' },
      ],
    });
    const api = mockApi(() => ({ masterEnabled: true, packs: [launchPack], removedBundled: [] }));
    (api as Record<string, unknown>).startMiniAppRun = vi.fn(async () => ({ ok: true, runId: 'run-2' }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the runs for Sample review' }));
    await screen.findByRole('region', { name: 'Runs — Sample review' });
    fireEvent.click(screen.getByTestId('run-launch'));
    expect(await screen.findByTestId('pack-launch-menu')).toBeTruthy();
    expect((screen.getByTestId('launch-primary') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/tmp/demo' } });
    fireEvent.click(screen.getByTestId('launch-primary'));
    await waitFor(() => expect((api as Record<string, ReturnType<typeof vi.fn>>).startMiniAppRun).toHaveBeenCalledWith(PACK_ID, '/tmp/demo'));
    expect(api.saveMiniAppConfig).toHaveBeenCalledWith(PACK_ID, expect.objectContaining({ freshDays: 14 }));
  });

  it('opens the extension-sources page from the packs hub and returns', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Extension sources' }));
    expect(await screen.findByRole('region', { name: 'Pack sources' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('tabpanel', { name: 'Mini-apps' });
  });

  it('gives surface packs a Configure page but no Runs action', async () => {
    mockApi(() => ({
      masterEnabled: true,
      packs: [packView({ id: 'mini-translate', kind: 'surface', title: 'Translate pad', capabilities: ['ui', 'llm'] })],
      removedBundled: [],
    }));
    await openPacksHub();
    expect(await screen.findByRole('button', { name: 'Configure Translate pad' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open the runs for Translate pad' })).toBeNull();
  });

  it('opens the run report window from a run row without the modal', async () => {
    const api = mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the runs for Sample review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in window' }));
    await waitFor(() => expect(api.openMiniAppWindow).toHaveBeenCalledWith(PACK_ID, 'run-1'));
    expect(api.miniAppRunReport).not.toHaveBeenCalled();
  });

  it('falls back to the report modal when the window refuses', async () => {
    const api = mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    api.openMiniAppWindow = vi.fn(async () => ({ ok: false, error: 'refused' }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Open the runs for Sample review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in window' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(api.miniAppRunReport).toHaveBeenCalledWith('run-1');
  });

  it('returns to the hub with a notice when the routed pack disappears', async () => {
    mockApi(() => ({ masterEnabled: true, packs: [packView()], removedBundled: [] }));
    await openPacksHub();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Sample review' }));
    await screen.findByRole('region', { name: 'Pack settings — Sample review' });

    window.electronAPI.getMiniApps = vi.fn(async () => ({ masterEnabled: true, packs: [], removedBundled: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await screen.findByRole('tabpanel', { name: 'Mini-apps' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('no longer installed');
  });
});
