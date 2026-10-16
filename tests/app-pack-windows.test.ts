import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MiniAppRunReportView } from '@shared/app-pack';

vi.mock('electron', () => {
  class FakeBrowserWindow {
    static last: FakeBrowserWindow | undefined;
    static instances: FakeBrowserWindow[] = [];
    options: Record<string, unknown>;
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeBrowserWindow.last = this;
      FakeBrowserWindow.instances.push(this);
    }
    setMenuBarVisibility = vi.fn();
    once = vi.fn();
    on = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    destroy = vi.fn();
    isDestroyed = () => false;
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
  }
  return {
    app: { on: vi.fn(), getPath: () => '/tmp' },
    BrowserWindow: FakeBrowserWindow,
    nativeImage: { createFromPath: () => ({ isEmpty: true }) },
  };
});

vi.mock('@main/utils/config', () => ({ isDev: false, getAssetsPath: () => '/tmp/assets' }));
vi.mock('@main/window', () => ({ resolveTransparent: () => ({ transparent: false, source: 'test' }) }));
vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({ getConfig: () => ({}) }) },
}));

import { BrowserWindow } from 'electron';
import {
  MINIAPP_WINDOW_CAP_PER_PACK,
  MiniAppWindowService,
  createElectronPackWindow,
  type MiniAppWindowStore,
  type PackWindowHandle,
} from '@main/apps/windows';

const FakeBrowserWindow = BrowserWindow as unknown as {
  last: Record<string, unknown> & { webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn> } };
  instances: unknown[];
};

function reportView(packId: string): MiniAppRunReportView {
  return {
    run: {
      id: 'run-1',
      packId,
      packVersion: '1.0.0',
      rootPath: '/tmp/x',
      status: 'done',
      totals: null,
      estimateCalls: 0,
      actualCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
      conversationId: null,
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    },
    packTitle: 'Sample',
    items: [],
    reportNodes: [],
    labels: {},
    canArm: false,
    windowSupported: true,
  };
}

function makeHandle(): PackWindowHandle & { loadMock: ReturnType<typeof vi.fn>; focusMock: ReturnType<typeof vi.fn>; destroyMock: ReturnType<typeof vi.fn>; emitClosed: () => void } {
  const listeners: Array<() => void> = [];
  const loadMock = vi.fn(async () => undefined);
  const focusMock = vi.fn();
  const destroyMock = vi.fn();
  return {
    load: loadMock as unknown as PackWindowHandle['load'],
    onClosed: (listener) => {
      listeners.push(listener);
    },
    focus: focusMock,
    destroy: destroyMock,
    isDestroyed: () => false,
    loadMock,
    focusMock,
    destroyMock,
    emitClosed: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function memoryStore(): MiniAppWindowStore & { rows: Array<{ id: string; packId: string; runId: string; closedAt: number | null; closeReason: string | null }> } {
  const rows: Array<{ id: string; packId: string; runId: string; closedAt: number | null; closeReason: string | null }> = [];
  return {
    rows,
    create: async (row) => {
      rows.push({ id: row.id, packId: row.packId, runId: row.runId, closedAt: null, closeReason: null });
    },
    markClosed: async (id, reason, at) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) {
        row.closedAt = at;
        row.closeReason = reason;
      }
    },
  };
}

function makeService(overrides: Partial<Parameters<typeof makeDeps>[0]> = {}) {
  const handles: ReturnType<typeof makeHandle>[] = [];
  const store = memoryStore();
  const quitListeners: Array<() => void> = [];
  const state = {
    masterEnabled: true,
    packs: new Map<string, { enabled: boolean; error?: string; capabilities: string[]; title: string }>([
      ['sample-pack', { enabled: true, capabilities: ['report', 'ui:window'], title: 'Sample' }],
      ['plain-pack', { enabled: true, capabilities: ['report'], title: 'Plain' }],
      ['disabled-pack', { enabled: false, capabilities: ['report', 'ui:window'], title: 'Disabled' }],
    ]),
    reports: new Map<string, MiniAppRunReportView>([['run-1', reportView('sample-pack')]]),
  };
  function makeDeps() {
    return {
      config: () => ({ miniApps: { masterEnabled: state.masterEnabled } }) as never,
      packView: (packId: string) => state.packs.get(packId) ?? null,
      buildReportView: (runId: string) => Promise.resolve(state.reports.get(runId) ?? null),
      store,
      now: () => 42,
      newId: () => `id-${store.rows.length + 1}-${handles.length}`,
      createWindow: () => {
        const handle = makeHandle();
        handles.push(handle);
        return handle;
      },
      onQuit: (listener: () => void) => {
        quitListeners.push(listener);
      },
    };
  }
  const deps = { ...makeDeps(), ...overrides };
  const service = new MiniAppWindowService(deps);
  return { service, store, handles, state, quitListeners };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the constrained Electron window factory (charter hostEnforced law)', () => {
  it('never allows node integration, never bypasses context isolation, and sandboxes in production', async () => {
    const handle = createElectronPackWindow({ title: 'Sample — run' });
    await handle.load({ pack: 'sample-pack', run: 'run-1' });
    const instance = FakeBrowserWindow.last as unknown as { options: { webPreferences: Record<string, unknown> } };
    expect(instance.options.webPreferences.nodeIntegration).toBe(false);
    expect(instance.options.webPreferences.contextIsolation).toBe(true);
    expect(instance.options.webPreferences.sandbox).toBe(true);
    expect(instance.options.webPreferences.webSecurity).toBe(true);
    expect(instance.options.webPreferences.preload).toContain('preload');
  });

  it('denies window.open and loads the pack surface entry with the pack+run query', async () => {
    const handle = createElectronPackWindow({ title: 'Sample' });
    await handle.load({ pack: 'p', run: 'r' });
    const denyHandler = FakeBrowserWindow.last.webContents.setWindowOpenHandler.mock.calls[0][0] as () => { action: string };
    expect(denyHandler()).toEqual({ action: 'deny' });
    const instance = FakeBrowserWindow.instances[FakeBrowserWindow.instances.length - 1] as { loadFile: ReturnType<typeof vi.fn> };
    expect(instance.loadFile).toHaveBeenCalledWith(expect.stringContaining('pack-window.html'), { search: 'pack=p&run=r' });
  });
});

describe('MiniAppWindowService — the ui:window host surface', () => {
  it('opens a window for a declared, enabled pack and audits the open', async () => {
    const { service, store, handles } = makeService();
    const result = await service.openReportWindow('sample-pack', 'run-1');
    expect(result).toEqual({ ok: true, opened: true });
    expect(handles).toHaveLength(1);
    expect(handles[0].loadMock).toHaveBeenCalledWith({ pack: 'sample-pack', run: 'run-1' });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ packId: 'sample-pack', runId: 'run-1', closedAt: null, closeReason: null });
  });

  it('refuses undeclared use: a pack without ui:window never opens one', async () => {
    const { service, handles } = makeService();
    const result = await service.openReportWindow('plain-pack', 'run-1');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('ui:window');
    expect(handles).toHaveLength(0);
  });

  it('refuses unknown packs, disabled packs and unknown runs', async () => {
    const { service, state } = makeService();
    expect((await service.openReportWindow('ghost', 'run-1')).ok).toBe(false);
    expect((await service.openReportWindow('disabled-pack', 'run-1')).ok).toBe(false);
    expect((await service.openReportWindow('sample-pack', 'run-x')).ok).toBe(false);
    state.masterEnabled = false;
    expect((await service.openReportWindow('sample-pack', 'run-1')).ok).toBe(false);
  });

  it('refuses a run that belongs to a different pack', async () => {
    const { service, state } = makeService();
    state.packs.set('other-pack', { enabled: true, capabilities: ['report', 'ui:window'], title: 'Other' });
    const result = await service.openReportWindow('other-pack', 'run-1');
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('different pack');
  });

  it(`enforces the per-pack cap (${MINIAPP_WINDOW_CAP_PER_PACK}): the second open focuses, never creates`, async () => {
    const { service, handles } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    const second = await service.openReportWindow('sample-pack', 'run-1');
    expect(second).toEqual({ ok: true, opened: false });
    expect(handles).toHaveLength(1);
    expect(handles[0].focusMock).toHaveBeenCalledTimes(1);
    expect(service.openPackIds()).toEqual(['sample-pack']);
  });

  it('kill switch closes every open window and audits the reason', async () => {
    const { service, store, handles } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    service.closeAll('kill-switch');
    expect(handles[0].destroyMock).toHaveBeenCalledTimes(1);
    expect(store.rows[0].closeReason).toBe('kill-switch');
    expect(store.rows[0].closedAt).toBe(42);
    expect(service.openPackIds()).toEqual([]);
  });

  it('pack disable and pack removal close the pack window with their reasons', async () => {
    const { service, store, handles } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    service.closeForPack('sample-pack', 'pack-disabled');
    expect(handles[0].destroyMock).toHaveBeenCalledTimes(1);
    expect(store.rows[0].closeReason).toBe('pack-disabled');

    await service.openReportWindow('sample-pack', 'run-1');
    service.closeForPack('sample-pack', 'pack-removed');
    expect(store.rows[1].closeReason).toBe('pack-removed');
  });

  it('a user-closed window untracks and audits as user', async () => {
    const { service, store, handles } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    handles[0].emitClosed();
    expect(store.rows[0].closeReason).toBe('user');
    expect(service.openPackIds()).toEqual([]);
    const again = await service.openReportWindow('sample-pack', 'run-1');
    expect(again).toEqual({ ok: true, opened: true });
  });

  it('app shutdown (before-quit) closes everything', async () => {
    const { service, quitListeners, store } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    for (const listener of quitListeners) {
      listener();
    }
    expect(store.rows[0].closeReason).toBe('app-shutdown');
    expect(service.openPackIds()).toEqual([]);
  });

  it('boot reconciliation destroys anything that slipped through — no orphans', async () => {
    const { service, store, handles } = makeService();
    await service.openReportWindow('sample-pack', 'run-1');
    service.reconcileBoot();
    expect(handles[0].destroyMock).toHaveBeenCalledTimes(1);
    expect(store.rows[0].closeReason).toBe('boot-reconcile');
    expect(service.openPackIds()).toEqual([]);
  });
});
