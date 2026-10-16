import { app, BrowserWindow, nativeImage } from 'electron';
import { join } from 'path';
import type { AppConfig } from '@shared/config/AppConfig';
import type { MiniAppRunReportView } from '@shared/app-pack';
import { isDev, getAssetsPath } from '@main/utils/config';
import { getWebPreferences } from '@shared/constants/index';
import { resolveTransparent } from '@main/window';
import { MainConfigService } from '@main/services/ConfigService';

/** Charter degrade rules (ADR-0040 clause 16): window → page → panel; desktop honors window hosting. */
export const MINIAPP_WINDOW_DEGRADE_RULES: Record<string, string[]> = {
  window: ['page', 'panel'],
  page: ['panel'],
  panel: [],
};

/** Per-pack window cap — one host-owned surface window per pack. */
export const MINIAPP_WINDOW_CAP_PER_PACK = 1;

export type MiniAppWindowCloseReason =
  | 'user'
  | 'load-failed'
  | 'pack-disabled'
  | 'pack-removed'
  | 'kill-switch'
  | 'app-shutdown'
  | 'boot-reconcile';

/** One persisted row per window lifetime (the pack-stack audit convention — proposals persist, runs persist). */
export interface MiniAppWindowRow {
  id: string;
  packId: string;
  runId: string;
  openedAt: number;
  closedAt: number | null;
  closeReason: MiniAppWindowCloseReason | null;
}

export interface MiniAppWindowStore {
  create(row: MiniAppWindowRow): Promise<void>;
  markClosed(id: string, reason: MiniAppWindowCloseReason, at: number): Promise<void>;
}

/** The Electron seam — injectable so tests never open a real BrowserWindow. */
export interface PackWindowHandle {
  load(query: Record<string, string>): Promise<void>;
  onClosed(listener: () => void): void;
  focus(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface MiniAppWindowHostDeps {
  createWindow(options: { title: string }): PackWindowHandle;
  now(): number;
  newId(): string;
  store: MiniAppWindowStore;
  onQuit(listener: () => void): void;
}

export interface MiniAppWindowServiceDeps extends MiniAppWindowHostDeps {
  config(): AppConfig;
  packView(packId: string): { enabled: boolean; error?: string; capabilities: string[]; title: string } | null;
  buildReportView(runId: string): Promise<MiniAppRunReportView | null>;
}

export type MiniAppWindowOpenOutcome = { ok: true; opened: boolean } | { ok: false; error: string };

/**
 * The `ui:window` host surface (plan 32 Phase 4 / ADR-0040 clause 16):
 * one constrained, host-owned BrowserWindow per pack rendering the
 * pack's DECLARED declarative surface (its run report through the same
 * renderer path the in-app modal hosts). No node integration, no
 * contextIsolation bypass, family tokens via the same styling path as
 * in-app surfaces; closed automatically on pack disable, uninstall,
 * kill switch and app shutdown, with boot reconciliation as the
 * no-orphans backstop. Every open/close is audited (a `MiniAppWindow`
 * row per lifetime, the pack-stack convention).
 */
export class MiniAppWindowService {
  private readonly windows = new Map<string, { handle: PackWindowHandle; auditId: string; runId: string }>();

  constructor(private readonly deps: MiniAppWindowServiceDeps) {
    this.deps.onQuit(() => this.closeAll('app-shutdown'));
  }

  async openReportWindow(packId: string, runId: string): Promise<MiniAppWindowOpenOutcome> {
    if (!this.deps.config().miniApps.masterEnabled) {
      return { ok: false, error: 'Mini-apps are switched off (master kill switch).' };
    }
    const view = this.deps.packView(packId);
    if (!view) {
      return { ok: false, error: 'Unknown pack.' };
    }
    if (view.error) {
      return { ok: false, error: view.error };
    }
    if (!view.enabled) {
      return { ok: false, error: 'The pack is disabled.' };
    }
    if (!view.capabilities.includes('ui:window')) {
      return { ok: false, error: 'The pack does not declare the ui:window capability.' };
    }
    const existing = this.windows.get(packId);
    if (existing && !existing.handle.isDestroyed()) {
      existing.handle.focus();
      return { ok: true, opened: false };
    }
    this.windows.delete(packId);
    const report = await this.deps.buildReportView(runId);
    if (!report) {
      return { ok: false, error: 'Unknown run.' };
    }
    if (report.run.packId !== packId) {
      return { ok: false, error: 'The run belongs to a different pack.' };
    }
    const auditId = this.deps.newId();
    const handle = this.deps.createWindow({ title: `${report.packTitle} \u2014 ${report.run.id}` });
    this.windows.set(packId, { handle, auditId, runId });
    handle.onClosed(() => {
      if (this.windows.get(packId)?.auditId === auditId) {
        this.windows.delete(packId);
        void this.deps.store.markClosed(auditId, 'user', this.deps.now()).catch(() => undefined);
      }
    });
    await this.deps.store.create({ id: auditId, packId, runId, openedAt: this.deps.now(), closedAt: null, closeReason: null });
    try {
      await handle.load({ pack: packId, run: runId });
    } catch (error) {
      this.closeForPack(packId, 'load-failed');
      return { ok: false, error: `The pack window failed to load: ${String((error as Error)?.message ?? error)}` };
    }
    return { ok: true, opened: true };
  }

  /** Pack ids with a live window (the cap census — one per pack by construction). */
  openPackIds(): string[] {
    return [...this.windows.keys()];
  }

  closeForPack(packId: string, reason: MiniAppWindowCloseReason): void {
    const entry = this.windows.get(packId);
    if (!entry) {
      return;
    }
    this.windows.delete(packId);
    entry.handle.destroy();
    void this.deps.store.markClosed(entry.auditId, reason, this.deps.now()).catch(() => undefined);
  }

  closeAll(reason: MiniAppWindowCloseReason): void {
    for (const packId of [...this.windows.keys()]) {
      this.closeForPack(packId, reason);
    }
  }

  /** Boot reconciliation: a fresh boot tracks nothing — anything alive is an orphan and dies here. */
  reconcileBoot(): void {
    this.closeAll('boot-reconcile');
  }
}

/** The production Electron window factory: the constrained BrowserWindow (charter hostEnforced law). */
export function createElectronPackWindow(options: { title: string }): PackWindowHandle {
  const preloadPath = join(__dirname, '../preload/preload.js');
  const port = Number(process.env.VITE_PORT) || 3300;
  const look = resolveTransparent(MainConfigService.getInstance().getConfig().window?.transparent);
  const window = new BrowserWindow({
    width: 920,
    height: 700,
    minWidth: 520,
    minHeight: 400,
    show: false,
    frame: false,
    transparent: look.transparent,
    backgroundColor: look.transparent ? '#00000000' : '#1a1d29',
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    hasShadow: !look.transparent,
    icon: nativeImage.createFromPath(join(getAssetsPath(), 'icons', 'icon.png')),
    webPreferences: getWebPreferences(isDev, preloadPath),
    title: options.title,
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(`http://localhost:${port}`) : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
    }
  });
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
  });
  return {
    load: async (query) => {
      const search = new URLSearchParams(query).toString();
      if (isDev) {
        await window.loadURL(`http://localhost:${port}/pack-window.html?${search}`);
      } else {
        await window.loadFile(join(__dirname, '../renderer/pack-window.html'), { search });
      }
    },
    onClosed: (listener) => window.on('closed', listener),
    focus: () => window.focus(),
    destroy: () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    },
    isDestroyed: () => window.isDestroyed(),
  };
}

/** The composition-root wiring helper (production deps over the Electron factory). */
export function createMiniAppWindowService(
  deps: {
    config(): AppConfig;
    packView(packId: string): { enabled: boolean; error?: string; capabilities: string[]; title: string } | null;
    buildReportView(runId: string): Promise<MiniAppRunReportView | null>;
    store: MiniAppWindowStore;
    now(): number;
    newId(): string;
  }
): MiniAppWindowService {
  return new MiniAppWindowService({
    ...deps,
    createWindow: createElectronPackWindow,
    onQuit: (listener) => app.on('before-quit', listener),
  });
}
