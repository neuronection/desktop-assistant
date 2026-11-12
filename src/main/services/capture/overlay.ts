import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { getWebPreferences } from '@shared/constants/window';
import type { CaptureOverlaySession, CaptureSelection } from '@shared/capture';
import type { CaptureOverlayPort, CaptureOverlayReply } from './CaptureService';

// Same override the vite config consumes (family dev-port band: desktop :3300).
const DEV_SERVER_URL = `http://localhost:${Number(process.env.VITE_PORT) || 3300}`;
const OVERLAY_TIMEOUT_MS = 120_000;

interface PendingCapture {
  session: CaptureOverlaySession;
  resolve: (reply: CaptureOverlayReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The frozen-frame overlay window (plan 80, D2): one transparent, focusable,
 * always-on-top surface exactly covering the display under the pointer.
 *
 * It is ephemeral by design — created per session, destroyed on commit, cancel
 * or timeout. A renderer crash is a cancel, not a resurrection: there is no
 * frame to re-ask about.
 */
export class CaptureOverlayController implements CaptureOverlayPort {
  private window: BrowserWindow | null = null;
  private pending: PendingCapture | null = null;
  private ready = false;

  constructor(private readonly deps: { isDev: boolean; preloadPath: string }) {}

  public open(session: CaptureOverlaySession): Promise<CaptureOverlayReply> {
    this.destroy();
    return new Promise<CaptureOverlayReply>((resolve) => {
      const timer = setTimeout(() => {
        this.finish(null);
      }, OVERLAY_TIMEOUT_MS);
      this.pending = { session, resolve, timer };
      void this.create(session);
    });
  }

  /** Renderer handshake: it is mounted and subscribed, so the session can go. */
  public markReady(): void {
    this.ready = true;
    this.pushSession();
  }

  public commit(selection: CaptureSelection | null): boolean {
    if (!this.pending) {
      return false;
    }
    this.finish(selection);
    return true;
  }

  public cancel(): void {
    this.finish(null);
  }

  public close(): void {
    this.finish(null);
  }

  private pushSession(): void {
    const pending = this.pending;
    const window = this.window;
    if (!pending || !window || window.isDestroyed() || !this.ready) {
      return;
    }
    window.webContents.send('capture:session', pending.session);
  }

  private finish(selection: CaptureSelection | null): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
    }
    this.ready = false;
    this.destroy();
    pending?.resolve({ selection });
  }

  private destroy(): void {
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) {
      window.destroy();
    }
  }

  private async create(session: CaptureOverlaySession): Promise<void> {
    const display =
      screen.getAllDisplays().find((candidate) => candidate.id === session.display.id) ??
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    const window = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      title: 'Desktop Assistant — Capture',
      webPreferences: {
        ...getWebPreferences(this.deps.isDev, this.deps.preloadPath),
        backgroundThrottling: false,
      },
    });
    this.window = window;
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = this.deps.isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
      }
    });
    window.webContents.on('render-process-gone', () => {
      this.finish(null);
    });
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null;
      }
      if (this.pending) {
        this.finish(null);
      }
    });
    try {
      if (this.deps.isDev) {
        await window.loadURL(`${DEV_SERVER_URL}/capture-overlay.html`);
      } else {
        await window.loadFile(join(__dirname, '../../renderer/capture-overlay.html'));
      }
    } catch (error) {
      console.warn('Failed to load capture-overlay.html:', error);
      this.finish(null);
      return;
    }
    if (this.window !== window) {
      return;
    }
    window.show();
    window.focus();
  }
}
