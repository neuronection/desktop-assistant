import { app, BrowserWindow, Menu, screen, shell, nativeImage } from 'electron';
import { join } from 'path';
import { EventEmitter } from 'events';
import {
  WINDOW_SIZE,
  getWindowSize,
  validateDimensions,
  computeCornerResizeBounds,
  computeMovedPosition,
  computeSpeechHudBounds,
  computeSpeechHudBoundsForStyle,
  decideSpeechHudVisibility,
  speechHudTransparentFor,
  dragHudBounds,
  dropHudPlacement,
  edgeSwitchTarget,
  EDGE_SWITCH_DWELL_MS,
  EDGE_SWITCH_COOLDOWN_MS,
  EDGE_SWITCH_MIN_DRAG_PX,
  buildSpeechOverlayWindowOptions,
  buildLiveHostWindowOptions,
  buildHubPopoverWindowOptions,
  buildTransportPopoverWindowOptions,
  computeTransportPopoverBounds,
  HUB_POPOVER_SIZE,
  getCenterPosition,
  getWebPreferences,
  SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL
} from '@shared/constants/index';
import { getAssetsPath, isDev } from '@main/utils/config';
import { MainConfigService } from '@main/services/ConfigService';
import { TIMING } from '@shared/constants/timing.js';
import { WindowState, type ResizeCorner, type SettingsOpenTarget } from '@shared/types';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL, LIVE_SPOKEN_MAX_CHARS, type LiveSnapshot } from '@shared/live';
import {
  hudSizeTokens,
  isVerticalEdge,
  type SpeechHudDock,
  type SpeechHudEdgeSide,
  type SpeechHudStyle,
} from '@shared/speechHud';
import type { AppConfig } from '@shared/config/AppConfig';
import { buildSpeechHudMenuTemplate } from '@main/speechHudMenu';
import { resizeTargetChanged } from '@main/windowResize';
import { attachRenderCrashRecovery } from '@main/windowCrash';

const SETTINGS_WINDOW_SIZE = {
  WIDTH: 880,
  HEIGHT: 780,
  MIN_WIDTH: 680,
  MIN_HEIGHT: 500,
};

const DESKTOP_WINDOW_SIZE = {
  WIDTH: 1080,
  HEIGHT: 720,
  MIN_WIDTH: 980,
  MIN_HEIGHT: 640,
};

const RESULT_WINDOW_SIZE = {
  WIDTH: 920,
  HEIGHT: 700,
  MIN_WIDTH: 520,
  MIN_HEIGHT: 400,
};

// Transparency is a progressive enhancement (family window-look contract):
// Cinnamon/Mint auto-minimizes always-on-top transparent frameless windows
// (they render as nothing at all), so Linux+Cinnamon defaults to a solid,
// shadowed window unless the user opts into glass via Settings.
// DESKTOP_ASSISTANT_OPAQUE=1 forces opaque everywhere;
// DESKTOP_ASSISTANT_OPAQUE=0 forces glass even on Cinnamon.
const OPAQUE_ENV = process.env.DESKTOP_ASSISTANT_OPAQUE ?? '';
const CINNAMON_LINUX =
  process.platform === 'linux' &&
  /cinnamon/i.test(process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? '');

// Dev renderer URL (family dev-port bands, the family dev-ports.md standard):
// desktop is slot 3 → vite :3300. VITE_PORT is the same override the vite
// config consumes; run-dev.sh exports it so main and renderer always agree.
const DEV_SERVER_PORT = Number(process.env.VITE_PORT) || 3300;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

export function resolveTransparent(configTransparent: boolean | undefined): { transparent: boolean; source: string } {
  if (OPAQUE_ENV) {
    const forcedOpaque = ['1', 'true'].includes(OPAQUE_ENV);
    return { transparent: !forcedOpaque, source: 'env' };
  }
  if (typeof configTransparent === 'boolean') {
    return { transparent: configTransparent, source: 'config' };
  }
  return { transparent: !CINNAMON_LINUX, source: CINNAMON_LINUX ? 'cinnamon-default' : 'auto' };
}

export class WindowManager extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private settingsWindow: BrowserWindow | null = null;
  private desktopWindow: BrowserWindow | null = null;
  private resultWindow: BrowserWindow | null = null;
  private speechOverlay: BrowserWindow | null = null;
  private speechHideTimer: NodeJS.Timeout | null = null;
  private speechHudDrag: {
    origin: { x: number; y: number; width: number; height: number };
    startCursor: { x: number; y: number };
    lastCursor: { x: number; y: number };
    side: SpeechHudEdgeSide;
    grabOffset: number;
    candidate: { side: SpeechHudEdgeSide; since: number } | null;
    blockedSide: SpeechHudEdgeSide | null;
    lastSwitchAt: number;
    moved: number;
  } | null = null;
  private edgeSwitchTimer: ReturnType<typeof setTimeout> | null = null;
  private speechOverlayPending: Promise<BrowserWindow | null> | null = null;
  private speechSnapshot: SpeechSnapshot = SPEECH_INITIAL;
  private liveSnapshot: LiveSnapshot = LIVE_INITIAL;
  private hudBusy = false;
  private speechHudSyncSeq = 0;
  private hubPopover: BrowserWindow | null = null;
  private hubPopoverPending: Promise<BrowserWindow | null> | null = null;
  private transportPopover: BrowserWindow | null = null;
  private transportPopoverPending: Promise<BrowserWindow | null> | null = null;
  private hubHidden = false;
  private hubForceShow = false;
  private hudMenuControls: {
    togglePause: () => void;
    stopSpeech: () => void;
    endLive: () => void;
  } | null = null;
  private liveHost: BrowserWindow | null = null;
  private liveHostPending: Promise<BrowserWindow | null> | null = null;
  private liveHostReady = false;
  private liveHostSpeakSeq = 0;
  private pendingLiveHostStart: {
    bargeInOnSpeakers: boolean;
    spokenMaxChars: number;
    failure?: 'mic_denied';
  } | null = null;
  private pendingLiveHostSpeak: { session: number; generation: number; text: string } | null = null;
  private speechMetricsBound = false;
  private isHidden = false;
  private isAppQuitting = false;
  private configService = MainConfigService.getInstance();
  private savePositionDebounce: NodeJS.Timeout | null = null;
  private saveBoundsDebounce: NodeJS.Timeout | null = null;
  private saveDesktopBoundsDebounce: NodeJS.Timeout | null = null;
  private cornerResize: ({ corner: ResizeCorner } & { x: number; y: number; width: number; height: number }) | null = null;

  constructor() {
    super();
    app.on('before-quit', () => {
      this.isAppQuitting = true;
    });
    app.on('browser-window-focus', (_event, window) => {
      if (this.hubPopover && !this.hubPopover.isDestroyed() && window !== this.hubPopover) {
        this.hideHubPopover();
      }
    });
  }

  async createMainWindow(startHidden = false): Promise<BrowserWindow> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
      return this.mainWindow;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    const windowConfig = this.configService.getWindowSettings();

    let width, height, x, y;

    if (windowConfig.rememberedBounds) {
      width = windowConfig.rememberedBounds.width;
      height = windowConfig.rememberedBounds.height;
      x = windowConfig.rememberedBounds.x;
      y = windowConfig.rememberedBounds.y;
    } else {
      const defaultSize = getWindowSize(WindowState.COMPACT, null, null);
      width = defaultSize.width;
      height = defaultSize.height;
      // Use saved position or calculate center position
      const defaultPosition = getCenterPosition(width, height, screenWidth, screenHeight);
      x = windowConfig.position?.x ?? defaultPosition.x;
      y = windowConfig.position?.y ?? defaultPosition.y;
    }

    // Clamp the restored position onto the visible displays — a saved
    // position from a detached monitor must never open off-screen.
    const look = resolveTransparent(windowConfig.transparent);
    console.log('[window] displays:', screen.getAllDisplays().map((d) => JSON.stringify(d.workArea)).join(' '));
    console.log(`[window] restore geometry: ${x},${y} ${width}x${height} (opaque: ${!look.transparent} via ${look.source})`);
    const clampedRestore = this.clampToWorkArea(x, y, width, height);
    if (clampedRestore.x !== x || clampedRestore.y !== y) {
      console.log(`Window position outside visible displays; clamped to ${clampedRestore.x},${clampedRestore.y}.`);
      x = clampedRestore.x;
      y = clampedRestore.y;
    }

    const iconPath = join(getAssetsPath(), 'icons', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    const preloadMainPath = join(__dirname, '../preload/preload.generated.js');

    this.mainWindow = new BrowserWindow({
      width: width,
      height: height,
      minWidth: WINDOW_SIZE.MIN_WIDTH,
      minHeight: WINDOW_SIZE.MIN_HEIGHT,
      x: x,
      y: y,
      show: false,
      frame: false,
      transparent: look.transparent,
      backgroundColor: look.transparent ? '#00000000' : '#1a1d29',
      alwaysOnTop: windowConfig.alwaysOnTop ?? true,
      skipTaskbar: false,
      resizable: false,
      maximizable: false,
      minimizable: true,
      icon: icon,
      webPreferences: getWebPreferences(isDev, preloadMainPath),
      hasShadow: false,
    });

    // Set window properties
    this.mainWindow.setMenuBarVisibility(false);
    this.mainWindow.setAutoHideMenuBar(true);

    // Bind window events
    this.bindWindowEvents(this.mainWindow, 'main');

    attachRenderCrashRecovery(this.mainWindow, {
      role: 'launcher',
      recreate: async () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.destroy();
        }
        this.mainWindow = null;
        await this.createMainWindow(false);
      },
    });

    this.mainWindow.once('ready-to-show', () => {
      if (startHidden) {
        this.isHidden = true;
        console.log('Main window starting hidden in the tray (--hidden).');
        return;
      }
      this.mainWindow?.show();
      this.mainWindow?.focus();
    });

    return this.mainWindow;
  }
  async loadApp(){
    if (!this.mainWindow) return;

    if (isDev) {
      await this.mainWindow.loadURL(DEV_SERVER_URL);
    } else {
      const mainHtmlPath = join(__dirname, '../renderer/index.html');
      await this.mainWindow.loadFile(mainHtmlPath);
    }
  }

  async createSettingsWindow(): Promise<BrowserWindow> {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    // Find the display where the cursor is currently located (Active Screen)
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { width: screenWidth, height: screenHeight, x: screenX, y: screenY } = activeDisplay.workArea;

    const width = Math.min(SETTINGS_WINDOW_SIZE.WIDTH, screenWidth);
    const height = Math.min(SETTINGS_WINDOW_SIZE.HEIGHT, screenHeight);

    const centerPos = getCenterPosition(
      width,
      height,
      screenWidth,
      screenHeight
    );

    // Add offset to position correctly on the active monitor
    const x = screenX + centerPos.x;
    const y = screenY + centerPos.y;

    const preloadSettingsPath = join(__dirname, '../preload/preload.generated.js');
    const settingsLook = resolveTransparent(this.configService.getConfig().window?.transparent);

    this.settingsWindow = new BrowserWindow({
      width: width,
      height: height,
      minWidth: SETTINGS_WINDOW_SIZE.MIN_WIDTH,
      minHeight: SETTINGS_WINDOW_SIZE.MIN_HEIGHT,
      x: x,
      y: y,
      show: false,
      frame: false,
      transparent: settingsLook.transparent,
      backgroundColor: settingsLook.transparent ? '#00000000' : '#1a1d29',
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      maximizable: false,
      minimizable: true,
      modal: false,
      hasShadow: !settingsLook.transparent,
      webPreferences: getWebPreferences(isDev, preloadSettingsPath),
      title: 'Desktop Assistant Settings',
    });

    this.settingsWindow.setMenuBarVisibility(false);

    const settingsHtmlPath = join(__dirname, '../renderer/settings.html');
    if (isDev) {
      try {
        await this.settingsWindow.loadURL(`${DEV_SERVER_URL}/settings.html`);
      } catch {
        console.warn('Failed to load settings.html from dev server, trying file path...');
        await this.settingsWindow.loadFile(settingsHtmlPath);
      }
    } else {
      await this.settingsWindow.loadFile(settingsHtmlPath);
    }

    this.bindWindowEvents(this.settingsWindow, 'settings');

    attachRenderCrashRecovery(this.settingsWindow, {
      role: 'settings',
      recreate: () => {
        if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
          this.settingsWindow.destroy();
        }
        this.settingsWindow = null;
        void this.showSettingsWindow();
      },
    });

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow?.show();
      this.settingsWindow?.focus();
      this.flushSettingsNav();
    });

    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  /**
   * Mirrors the bus onto the HUD (plan 58 §4.2 + plan 62): the snapshots are
   * remembered and one sync decides visibility. The HUD and a visible chat
   * surface never share the screen; the hidden overlay stays alive as the
   * speech-bus audio endpoint.
   */
  async applySpeechSnapshot(snapshot: SpeechSnapshot): Promise<void> {
    this.speechSnapshot = snapshot;
    await this.syncSpeechHudVisibility();
  }

  /** Live presence feeds the same decision; idle is the only hidden live state. */
  async applyLiveSnapshot(snapshot: LiveSnapshot): Promise<void> {
    this.liveSnapshot = snapshot;
    await this.syncSpeechHudVisibility();
  }

  public setHudBusy(active: boolean): void {
    if (this.hudBusy === active) {
      return;
    }
    this.hudBusy = active;
    this.refreshSpeechHud();
  }

  /** Re-evaluate the HUD after boot/config/window/style changes. */
  public refreshSpeechHud(): void {
    void this.syncSpeechHudVisibility();
  }

  private async syncSpeechHudVisibility(): Promise<void> {
    if (this.isAppQuitting) {
      return;
    }
    const seq = (this.speechHudSyncSeq += 1);
    const voice = this.configService.getConfig().voice;
    const posture = voice?.speechHudPosture ?? 'auto';
    const chatSurfaceVisible = this.areChatWindowsVisible();
    const action = this.hubHidden
      ? 'hide'
      : this.hubForceShow && !chatSurfaceVisible
        ? 'show'
        : decideSpeechHudVisibility({
            posture,
            style: voice?.speechHudStyle ?? 'card',
            chatSurfaceVisible,
            speechState: this.speechSnapshot.state,
            speechDismissed: this.speechSnapshot.dismissed === true,
            liveState: this.liveSnapshot.state,
            hudBusy: this.hudBusy,
          });
    const audioActive = this.speechSnapshot.state !== 'idle' || this.liveSnapshot.state !== 'idle';
    const existing = this.speechOverlay && !this.speechOverlay.isDestroyed();
    if (action !== 'show' && !audioActive && !existing) {
      this.cancelSpeechOverlayHide();
      this.hideTransportPopover();
      return;
    }
    const window = await this.ensureSpeechOverlayWindow();
    if (!window || window.isDestroyed() || seq !== this.speechHudSyncSeq) {
      return;
    }
    if (action === 'show') {
      this.cancelSpeechOverlayHide();
      if (!window.isVisible()) {
        this.positionSpeechOverlay(window);
        window.showInactive();
      }
      this.syncTransportPopover(window);
      return;
    }
    this.hideTransportPopover();
    if (action === 'fade') {
      this.hideHubPopover();
      if (window.isVisible()) {
        this.scheduleSpeechOverlayHide();
      } else {
        this.cancelSpeechOverlayHide();
      }
      return;
    }
    this.cancelSpeechOverlayHide();
    if (window.isVisible()) {
      window.hide();
    }
    this.hideHubPopover();
    this.hideTransportPopover();
  }

  private scheduleSpeechOverlayHide(): void {
    if (!this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    this.cancelSpeechOverlayHide();
    this.speechHideTimer = setTimeout(() => {
      this.speechHideTimer = null;
      this.hideHubPopover();
      if (this.speechOverlay && !this.speechOverlay.isDestroyed()) {
        this.speechOverlay.hide();
      }
    }, 1500);
  }

  private cancelSpeechOverlayHide(): void {
    if (this.speechHideTimer) {
      clearTimeout(this.speechHideTimer);
      this.speechHideTimer = null;
    }
  }

  private positionSpeechOverlay(window: BrowserWindow): void {
    const bounds = window.getBounds();
    const display =
      bounds.width > 0 && bounds.height > 0
        ? screen.getDisplayMatching(bounds)
        : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.applySpeechHudBounds(window, this.speechHudBounds(display.workArea));
  }

  /**
   * Applies HUD bounds to the frameless window. A `resizable: false` window
   * carries min=max size hints, so X11 WMs ignore a resize; the size hint is
   * lifted for the single `setBounds` call and restored immediately (one
   * call, the X11 law).
   */
  private applySpeechHudBounds(
    window: BrowserWindow,
    bounds: { x: number; y: number; width: number; height: number }
  ): void {
    const current = window.getBounds();
    const sizeChanged = current.width !== bounds.width || current.height !== bounds.height;
    if (sizeChanged) {
      window.setResizable(true);
    }
    window.setBounds(bounds);
    if (sizeChanged) {
      window.setResizable(false);
    }
  }

  private speechHudBounds(workArea: { x: number; y: number; width: number; height: number }) {
    const voice = this.configService.getConfig().voice;
    return computeSpeechHudBoundsForStyle({
      placement: {
        style: voice?.speechHudStyle ?? 'card',
        corner: voice?.speechHudCorner ?? 'bottom-right',
        edge: {
          side: voice?.speechHudEdgeSide ?? 'right',
          ratio: voice?.speechHudEdgeRatio ?? 0.5,
        },
        dot: {
          xRatio: voice?.speechHudDotXRatio ?? 1,
          yRatio: voice?.speechHudDotYRatio ?? 1,
        },
      },
      workArea,
      dock: this.speechHudDock(),
    });
  }

  /**
   * One window, re-bounded on style switch (plan 58 addendum): the overlay is
   * never recreated for a style change — a single `setBounds` per change (the
   * X11 law for a frameless `resizable: false` window).
   */
  public applyHudContentProtection(): void {
    const protectedNow = this.configService.getConfig().voice?.hudContentProtection === true;
    if (this.speechOverlay && !this.speechOverlay.isDestroyed()) {
      this.speechOverlay.setContentProtection(protectedNow);
    }
    if (this.hubPopover && !this.hubPopover.isDestroyed()) {
      this.hubPopover.setContentProtection(protectedNow);
    }
  }

  /**
   * One presence surface, re-shaped on a style change. X11 WMs ignore size
   * changes for a `resizable: false` frameless window (the min=max size
   * hints win even with the hint lifted around `setBounds`), so a size
   * change recreates the window at the new style while a same-size change
   * only repositions. Audio continuity is kept by the overlay's mount
   * resync (`speech:current-chunk`), which resumes the current chunk.
   */
  public applySpeechHudStyle(): void {
    if (!this.speechHudDrag) {
      this.sendEdgePreview(null);
    }
    this.applyHudContentProtection();
    if (!this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    const display = screen.getDisplayMatching(this.speechOverlay.getBounds());
    const bounds = this.speechHudBounds(display.workArea);
    const current = this.speechOverlay.getBounds();
    if (current.width === bounds.width && current.height === bounds.height) {
      this.applySpeechHudBounds(this.speechOverlay, bounds);
      this.refreshSpeechHud();
      return;
    }
    this.destroySpeechOverlay();
    void this.ensureSpeechOverlayWindow().then((window) => {
      if (!window) {
        return;
      }
      this.applySpeechHudBounds(window, this.speechHudBounds(display.workArea));
      this.refreshSpeechHud();
    });
  }

  public beginSpeechHudDrag(x: number, y: number): void {
    if (!this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    const origin = this.speechOverlay.getBounds();
    const voice = this.configService.getConfig().voice;
    const side = voice?.speechHudEdgeSide ?? 'right';
    const vertical = isVerticalEdge(side);
    this.clearEdgeSwitchTimer();
    this.hideTransportPopover();
    this.sendEdgePreview(side);
    this.speechHudDrag = {
      origin,
      startCursor: { x, y },
      lastCursor: { x, y },
      side,
      grabOffset: vertical ? y - origin.y : x - origin.x,
      candidate: null,
      blockedSide: null,
      lastSwitchAt: 0,
      moved: 0,
    };
  }

  private clearEdgeSwitchTimer(): void {
    if (this.edgeSwitchTimer) {
      clearTimeout(this.edgeSwitchTimer);
      this.edgeSwitchTimer = null;
    }
  }

  private sendEdgePreview(side: SpeechHudEdgeSide | null): void {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed() && window.webContents.getURL().includes('speech-overlay.html')) {
        window.webContents.send('hud:edge-preview', { side });
      }
    });
  }

  private positionEdgeDrag(
    drag: NonNullable<WindowManager['speechHudDrag']>,
    cursor: { x: number; y: number },
    workArea: { x: number; y: number; width: number; height: number }
  ): void {
    if (!this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    const width = drag.origin.width;
    const height = drag.origin.height;
    const clamp = (value: number, min: number, max: number): number =>
      Math.min(Math.max(value, min), max);
    if (isVerticalEdge(drag.side)) {
      const y = clamp(cursor.y - drag.grabOffset, workArea.y, workArea.y + workArea.height - height);
      const x = drag.side === 'left' ? workArea.x : workArea.x + workArea.width - width;
      this.applySpeechHudBounds(this.speechOverlay, {
        x: Math.round(x),
        y: Math.round(y),
        width,
        height,
      });
      return;
    }
    const x = clamp(cursor.x - drag.grabOffset, workArea.x, workArea.x + workArea.width - width);
    const y = drag.side === 'top' ? workArea.y : workArea.y + workArea.height - height;
    this.applySpeechHudBounds(this.speechOverlay, {
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
    });
  }

  private switchSpeechHudEdge(
    drag: NonNullable<WindowManager['speechHudDrag']>,
    side: SpeechHudEdgeSide,
    cursor: { x: number; y: number },
    workArea: { x: number; y: number; width: number; height: number }
  ): void {
    if (side === drag.side) {
      return;
    }
    const previous = drag.side;
    const sameOrientation = isVerticalEdge(previous) === isVerticalEdge(side);
    if (!sameOrientation) {
      drag.grabOffset = isVerticalEdge(side) ? drag.origin.height / 2 : drag.origin.width / 2;
    }
    drag.side = side;
    drag.blockedSide = previous;
    drag.lastSwitchAt = Date.now();
    drag.candidate = null;
    this.clearEdgeSwitchTimer();
    this.sendEdgePreview(side);
    this.positionEdgeDrag(drag, cursor, workArea);
  }

  private maybeSwitchSpeechHudEdge(
    drag: NonNullable<WindowManager['speechHudDrag']>,
    cursor: { x: number; y: number },
    workArea: { x: number; y: number; width: number; height: number }
  ): void {
    if (drag.moved < EDGE_SWITCH_MIN_DRAG_PX) {
      return;
    }
    if (Date.now() - drag.lastSwitchAt < EDGE_SWITCH_COOLDOWN_MS) {
      return;
    }
    const target = edgeSwitchTarget({
      cursor,
      workArea,
      currentSide: drag.side,
      blockedSide: drag.blockedSide,
    });
    if (target && !this.speechHudDock().text && isVerticalEdge(target.side) !== isVerticalEdge(drag.side)) {
      drag.candidate = null;
      this.clearEdgeSwitchTimer();
      return;
    }
    if (!target) {
      drag.candidate = null;
      this.clearEdgeSwitchTimer();
      return;
    }
    if (drag.candidate?.side !== target.side) {
      drag.candidate = { side: target.side, since: Date.now() };
      this.clearEdgeSwitchTimer();
      this.edgeSwitchTimer = setTimeout(() => {
        this.edgeSwitchTimer = null;
        const active = this.speechHudDrag;
        if (!active?.candidate) {
          return;
        }
        const display = screen.getDisplayNearestPoint(active.lastCursor);
        const next = edgeSwitchTarget({
          cursor: active.lastCursor,
          workArea: display.workArea,
          currentSide: active.side,
          blockedSide: active.blockedSide,
        });
        if (next?.side === active.candidate.side && active.moved >= EDGE_SWITCH_MIN_DRAG_PX) {
          this.switchSpeechHudEdge(active, next.side, active.lastCursor, display.workArea);
        }
      }, EDGE_SWITCH_DWELL_MS);
    }
    if (drag.candidate && Date.now() - drag.candidate.since >= EDGE_SWITCH_DWELL_MS) {
      this.switchSpeechHudEdge(drag, target.side, cursor, workArea);
    }
  }

  public moveSpeechHudDrag(x: number, y: number): void {
    const drag = this.speechHudDrag;
    if (!drag || !this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    const style = this.configService.getConfig().voice?.speechHudStyle ?? 'card';
    const display = screen.getDisplayNearestPoint({ x, y });
    drag.lastCursor = { x, y };
    drag.moved = Math.max(drag.moved, Math.hypot(x - drag.startCursor.x, y - drag.startCursor.y));
    if (style !== 'edge') {
      this.applySpeechHudBounds(
        this.speechOverlay,
        dragHudBounds({
          style,
          origin: drag.origin,
          dx: x - drag.startCursor.x,
          dy: y - drag.startCursor.y,
          workArea: display.workArea,
        })
      );
      return;
    }
    this.maybeSwitchSpeechHudEdge(drag, { x, y }, display.workArea);
    this.positionEdgeDrag(drag, { x, y }, display.workArea);
  }

  public endSpeechHudDrag(): void {
    const drag = this.speechHudDrag;
    this.speechHudDrag = null;
    this.clearEdgeSwitchTimer();
    if (!drag || !this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    const display = screen.getDisplayNearestPoint(drag.lastCursor);
    const voice = this.configService.getConfig().voice;
    const style: SpeechHudStyle = voice?.speechHudStyle ?? 'card';
    const side = drag.side;
    const placement = dropHudPlacement({
      style,
      bounds: this.speechOverlay.getBounds(),
      workArea: display.workArea,
      edgeSide: side,
    });
    this.applySpeechHudBounds(
      this.speechOverlay,
      computeSpeechHudBoundsForStyle({
        placement: {
          style,
          corner: placement.corner ?? voice?.speechHudCorner ?? 'bottom-right',
          edge: placement.edge,
          dot: placement.dot,
        },
        workArea: display.workArea,
        dock: this.speechHudDock(),
      })
    );
    void this.persistSpeechHudPlacement(placement).finally(() => {
      this.sendEdgePreview(side);
      this.refreshSpeechHud();
    });
  }

  public cancelSpeechHudDrag(): void {
    const drag = this.speechHudDrag;
    this.speechHudDrag = null;
    this.clearEdgeSwitchTimer();
    const side = this.configService.getConfig().voice?.speechHudEdgeSide ?? 'right';
    this.sendEdgePreview(side);
    if (!drag || !this.speechOverlay || this.speechOverlay.isDestroyed()) {
      return;
    }
    this.applySpeechHudBounds(this.speechOverlay, drag.origin);
    this.refreshSpeechHud();
  }

  private async persistSpeechHudPlacement(placement: {
    corner?: string;
    edge?: { side: SpeechHudEdgeSide; ratio: number };
    dot?: { xRatio: number; yRatio: number };
  }): Promise<void> {
    const current = this.configService.getConfig();
    const voice = { ...current.voice };
    if (placement.corner) {
      voice.speechHudCorner = placement.corner as typeof voice.speechHudCorner;
    }
    if (placement.edge) {
      voice.speechHudEdgeSide = placement.edge.side;
      voice.speechHudEdgeRatio = placement.edge.ratio;
    }
    if (placement.dot) {
      voice.speechHudDotXRatio = placement.dot.xRatio;
      voice.speechHudDotYRatio = placement.dot.yRatio;
    }
    try {
      await this.configService.updateConfig({ ...current, voice });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('config-updated', {
            voice: {
              speechHudCorner: voice.speechHudCorner,
              speechHudEdgeSide: voice.speechHudEdgeSide,
              speechHudEdgeRatio: voice.speechHudEdgeRatio,
              speechHudDotXRatio: voice.speechHudDotXRatio,
              speechHudDotYRatio: voice.speechHudDotYRatio,
            },
          });
        }
      }
    } catch (error) {
      console.warn('Failed to persist speech HUD position:', error);
    }
  }

  /** The style the overlay window is currently shaped for (tests + drag math). */
  public currentSpeechHudStyle(): SpeechHudStyle {
    return this.configService.getConfig().voice?.speechHudStyle ?? 'card';
  }

  /**
   * The HUD's right-click menu (plan 58 addendum): the tiny textless
   * surfaces gain navigation and style switching without another control.
   * Popup hangs off the overlay so the menu is owned by its window while
   * still being able to extend past the orb.
   */
  public setHudMenuControls(controls: {
    togglePause: () => void;
    stopSpeech: () => void;
    endLive: () => void;
  }): void {
    this.hudMenuControls = controls;
  }

  public showSpeechHudMenu(): void {
    const voice = this.configService.getConfig().voice;
    const style = voice?.speechHudStyle ?? 'card';
    const keepOnScreen = voice?.speechHudPosture === 'pinned';
    const menu = Menu.buildFromTemplate(
      buildSpeechHudMenuTemplate({
        style,
        sizePreset: voice?.hudSizePreset ?? 'comfort',
        keepOnScreen,
        speechActive: this.speechSnapshot.state !== 'idle' && this.hudMenuControls !== null,
        speechPaused: this.speechSnapshot.state === 'paused',
        liveActive: this.liveSnapshot.state !== 'idle' && this.hudMenuControls !== null,
        actions: {
          togglePause: () => this.hudMenuControls?.togglePause(),
          stopSpeech: () => this.hudMenuControls?.stopSpeech(),
          endLive: () => this.hudMenuControls?.endLive(),
          openAssistant: () => this.showMainWindow(),
          openHudSettings: () => this.showSettingsWindow({ tab: 'hub' }),
          openSpeechSettings: () => this.showSettingsWindow({ tab: 'voice' }),
          selectSize: (preset) => void this.updateSpeechHudVoice({ hudSizePreset: preset }),
          openQuickActions: () => void this.showHubPopover(),
          hideHub: () => this.hideSpeechHudForSession(),
          selectStyle: (next) => void this.updateSpeechHudVoice({ speechHudStyle: next }),
          toggleKeepOnScreen: () =>
            void this.updateSpeechHudVoice({
              speechHudPosture: this.configService.getConfig().voice?.speechHudPosture === 'pinned' ? 'auto' : 'pinned',
            }),
        },
      })
    );
    const overlay = this.speechOverlay && !this.speechOverlay.isDestroyed() ? this.speechOverlay : null;
    if (overlay) {
      menu.popup({ window: overlay });
    } else {
      menu.popup();
    }
  }

  /**
   * HUD-originated voice changes (style / posture) go through the same
   * config write as Settings: persist, tell every renderer, then re-shape
   * the overlay when the style changes its window size. The tray label is
   * refreshed by `hud-style-changed`.
   */
  private async updateSpeechHudVoice(patch: Partial<AppConfig['voice']>): Promise<void> {
    const current = this.configService.getConfig();
    try {
      await this.configService.updateConfig({ ...current, voice: { ...current.voice, ...patch } });
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('config-updated', { voice: patch });
        }
      }
      if (patch.speechHudStyle || patch.hudSizePreset || patch.hudCustomSize) {
        this.applySpeechHudStyle();
        if (patch.speechHudStyle) {
          this.emit('hud-style-changed');
        }
      }
      this.refreshSpeechHud();
    } catch (error) {
      console.warn('Failed to update the HUD from its menu:', error);
    }
  }

  private ensureSpeechOverlayWindow(): Promise<BrowserWindow | null> {
    if (this.speechOverlay && !this.speechOverlay.isDestroyed()) {
      return Promise.resolve(this.speechOverlay);
    }
    if (!this.speechOverlayPending) {
      this.speechOverlayPending = this.createSpeechOverlayWindow().finally(() => {
        this.speechOverlayPending = null;
      });
    }
    return this.speechOverlayPending;
  }

  private async createSpeechOverlayWindow(): Promise<BrowserWindow | null> {
    const style = this.currentSpeechHudStyle();
    const edgeSide = this.configService.getConfig().voice?.speechHudEdgeSide ?? 'right';
    const windowConfig = this.configService.getConfig().window;
    const look = resolveTransparent(windowConfig?.transparent);
    const transparent = speechHudTransparentFor({
      style,
      look,
      explicitlySet: windowConfig?.transparentSet === true,
    });
    const preloadPath = join(__dirname, '../preload/preload.generated.js');
    const window = new BrowserWindow(
      buildSpeechOverlayWindowOptions({
        isDev,
        preloadPath,
        transparent,
        style,
        edgeSide,
        dock: this.speechHudDock(),
      })
    );
    window.setAlwaysOnTop(true, SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (this.configService.getConfig().voice?.hudContentProtection === true) {
      window.setContentProtection(true);
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
      }
    });
    attachRenderCrashRecovery(window, {
      role: 'overlay',
      recreate: () => {
        if (this.speechOverlay && !this.speechOverlay.isDestroyed()) {
          this.speechOverlay.destroy();
        }
        this.speechOverlay = null;
        void this.ensureSpeechOverlayWindow();
      },
    });
    window.on('closed', () => {
      if (this.speechOverlay === window) {
        this.speechOverlay = null;
      }
    });
    const overlayHtmlPath = join(__dirname, '../renderer/speech-overlay.html');
    const query = transparent ? '' : '?opaque=1';
    try {
      if (isDev) {
        await window.loadURL(`${DEV_SERVER_URL}/speech-overlay.html${query}`);
      } else {
        await window.loadFile(overlayHtmlPath, transparent ? undefined : { query: { opaque: '1' } });
      }
    } catch (error) {
      console.warn('Failed to load speech-overlay.html:', error);
    }
    this.speechOverlay = window;
    if (!this.speechMetricsBound) {
      this.speechMetricsBound = true;
      screen.on('display-metrics-changed', this.handleDisplayMetricsChanged);
    }
    return window;
  }

  private readonly handleDisplayMetricsChanged = (): void => {
    if (this.speechOverlay && !this.speechOverlay.isDestroyed() && this.speechOverlay.isVisible()) {
      this.positionSpeechOverlay(this.speechOverlay);
    }
    this.refreshSpeechHud();
  };

  private async ensureTransportPopover(): Promise<BrowserWindow | null> {
    if (this.transportPopover && !this.transportPopover.isDestroyed()) {
      return this.transportPopover;
    }
    if (!this.transportPopoverPending) {
      this.transportPopoverPending = this.createTransportPopoverWindow().finally(() => {
        this.transportPopoverPending = null;
      });
    }
    return this.transportPopoverPending;
  }

  private async createTransportPopoverWindow(): Promise<BrowserWindow | null> {
    const preloadPath = join(__dirname, '../preload/preload.generated.js');
    const window = new BrowserWindow(
      buildTransportPopoverWindowOptions({ isDev, preloadPath })
    );
    window.setAlwaysOnTop(true, SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (this.configService.getConfig().voice?.hudContentProtection === true) {
      window.setContentProtection(true);
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
      }
    });
    window.on('closed', () => {
      if (this.transportPopover === window) {
        this.transportPopover = null;
      }
    });
    try {
      if (isDev) {
        await window.loadURL(`${DEV_SERVER_URL}/transport-popover.html`);
      } else {
        await window.loadFile(join(__dirname, '../renderer/transport-popover.html'));
      }
    } catch (error) {
      console.warn('Failed to load transport-popover.html:', error);
    }
    this.transportPopover = window;
    return window;
  }

  private hideTransportPopover(): void {
    if (this.transportPopover && !this.transportPopover.isDestroyed() && this.transportPopover.isVisible()) {
      this.transportPopover.hide();
    }
  }

  private syncTransportPopover(_overlay: BrowserWindow): void {
    // Built-in playback is a dock state, not a transport popup. The reserved
    // transport surface stays dormant for future mini-app action surfaces.
    this.hideTransportPopover();
  }

  /** The hub popover (plan 65): a separate window anchored to the dock. */
  public async ensureHubPopover(): Promise<BrowserWindow | null> {
    if (this.hubPopover && !this.hubPopover.isDestroyed()) {
      return this.hubPopover;
    }
    if (!this.hubPopoverPending) {
      this.hubPopoverPending = this.createHubPopoverWindow().finally(() => {
        this.hubPopoverPending = null;
      });
    }
    return this.hubPopoverPending;
  }

  private async createHubPopoverWindow(): Promise<BrowserWindow | null> {
    const preloadPath = join(__dirname, '../preload/preload.generated.js');
    const window = new BrowserWindow(buildHubPopoverWindowOptions({ isDev, preloadPath }));
    this.hubPopover = window;
    window.setAlwaysOnTop(true, SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL);
    if (this.configService.getConfig().voice?.hudContentProtection === true) {
      window.setContentProtection(true);
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
      }
    });
    window.on('closed', () => {
      if (this.hubPopover === window) {
        this.hubPopover = null;
      }
    });
    const htmlPath = join(__dirname, '../renderer/hub-popover.html');
    try {
      if (isDev) {
        await window.loadURL(`${DEV_SERVER_URL}/hub-popover.html`);
      } else {
        await window.loadFile(htmlPath);
      }
    } catch (error) {
      console.warn('Failed to load hub-popover.html:', error);
    }
    return window;
  }

  public async showHubPopover(): Promise<void> {
    const window = await this.ensureHubPopover();
    if (!window || window.isDestroyed()) {
      return;
    }
    this.hideTransportPopover();
    this.positionHubPopover(window);
    if (!window.isVisible()) {
      window.showInactive();
    }
  }

  public hideHubPopover(): void {
    if (this.hubPopover && !this.hubPopover.isDestroyed() && this.hubPopover.isVisible()) {
      this.hubPopover.hide();
    }
  }

  public toggleHubPopover(): void {
    if (this.hubPopover && !this.hubPopover.isDestroyed() && this.hubPopover.isVisible()) {
      this.hideHubPopover();
      return;
    }
    void this.showHubPopover();
  }

  private positionHubPopover(window: BrowserWindow): void {
    const overlay = this.speechOverlay && !this.speechOverlay.isDestroyed() ? this.speechOverlay : null;
    const display = overlay ? screen.getDisplayMatching(overlay.getBounds()) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const size = HUB_POPOVER_SIZE;
    const anchor = overlay
      ? overlay.getBounds()
      : { x: area.x + area.width - size.width - 18, y: area.y + area.height - size.height - 18, width: size.width, height: size.height };
    const voice = this.configService.getConfig().voice;
    const style = voice?.speechHudStyle ?? 'card';
    const side = voice?.speechHudEdgeSide ?? 'right';
    let x = anchor.x + anchor.width - size.width;
    let y = anchor.y + anchor.height - size.height;
    if (style === 'edge') {
      if (side === 'right') {
        x = anchor.x - size.width - 8;
        y = anchor.y + Math.round((anchor.height - size.height) / 2);
      } else if (side === 'left') {
        x = anchor.x + anchor.width + 8;
        y = anchor.y + Math.round((anchor.height - size.height) / 2);
      } else if (side === 'top') {
        x = anchor.x + anchor.width - size.width;
        y = anchor.y + anchor.height + 8;
      } else {
        x = anchor.x + anchor.width - size.width;
        y = anchor.y - size.height - 8;
      }
    } else if (anchor.y - size.height - 8 >= area.y) {
      x = anchor.x + anchor.width - size.width;
      y = anchor.y - size.height - 8;
    } else {
      x = anchor.x + anchor.width - size.width;
      y = anchor.y + anchor.height + 8;
    }
    const clampX = Math.min(Math.max(x, area.x + 8), area.x + area.width - size.width - 8);
    const clampY = Math.min(Math.max(y, area.y + 8), area.y + area.height - size.height - 8);
    window.setBounds({ x: Math.round(clampX), y: Math.round(clampY), width: size.width, height: size.height });
  }

  /** Hide the hub until the user summons it again (tray Show the HUD). */
  public hideSpeechHudForSession(): void {
    this.hubHidden = true;
    this.hubForceShow = false;
    this.hideHubPopover();
    this.refreshSpeechHud();
  }

  public showSpeechHud(): void {
    this.hubHidden = false;
    this.hubForceShow = true;
    this.hideHubPopover();
    this.refreshSpeechHud();
  }

  /** Wide-dock config: text mode plus the resolved size preset. */
  private speechHudDock(): SpeechHudDock {
    const voice = this.configService.getConfig().voice;
    const size = hudSizeTokens(voice?.hudSizePreset ?? 'comfort', voice?.hudCustomSize);
    const text = voice?.hubDockText === 'latest';
    return { text, width: text ? size.faceWidth : 30, size };
  }

  private sendLauncherEvent(channel: string, ...args: unknown[]): void {
    const send = (window: BrowserWindow): void => {
      if (window.isDestroyed()) {
        return;
      }
      const deliver = (): void => {
        if (!window.isDestroyed()) {
          window.webContents.send(channel, ...args);
        }
      };
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', deliver);
      } else {
        deliver();
      }
    };
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      void this.createMainWindow(false)
        .then(() => this.loadApp())
        .then(() => {
          if (this.mainWindow) {
            send(this.mainWindow);
          }
        });
      return;
    }
    this.showMainWindow();
    send(this.mainWindow);
  }

  /** The HUD owns dictation while it is up; the launcher is only the no-HUD fallback. */
  public startDictation(): void {
    const overlay = this.speechOverlay;
    const style = this.currentSpeechHudStyle();
    if (
      overlay &&
      !overlay.isDestroyed() &&
      overlay.isVisible() &&
      (style === 'edge' || style === 'dot')
    ) {
      overlay.webContents.send('hud:start-dictation');
      return;
    }
    this.sendLauncherEvent('launcher:start-dictation');
  }

  /** Open the launcher with a hub translation result in the composer. */
  public openLauncherWithText(text: string): void {
    this.sendLauncherEvent('launcher:open-with-text', text);
  }

  /**
   * The hidden live host (plan 61): owns the mic/VAD and live reply playback
   * so no visible window is the engine. Created lazily, kept for the app
   * session, never shown; a crash ends the live session instead of silently
   * resurrecting audio.
   */
  public async ensureLiveHost(): Promise<BrowserWindow | null> {
    if (this.liveHost && !this.liveHost.isDestroyed()) {
      return this.liveHost;
    }
    if (!this.liveHostPending) {
      this.liveHostPending = this.createLiveHostWindow().finally(() => {
        this.liveHostPending = null;
      });
    }
    return this.liveHostPending;
  }

  private async createLiveHostWindow(): Promise<BrowserWindow | null> {
    const preloadPath = join(__dirname, '../preload/preload.generated.js');
    const window = new BrowserWindow(buildLiveHostWindowOptions({ isDev, preloadPath }));
    // Assign before loading: the host's `live-host:ready` can arrive while
    // `loadURL` is still pending, and the ready flush needs the reference.
    this.liveHost = window;
    window.webContents.setBackgroundThrottling(false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
      }
    });
    window.webContents.on('render-process-gone', () => {
      if (this.isAppQuitting) {
        return;
      }
      this.liveHostReady = false;
      this.pendingLiveHostStart = null;
      this.pendingLiveHostSpeak = null;
      if (this.liveHost === window) {
        this.liveHost = null;
      }
      if (!window.isDestroyed()) {
        window.destroy();
      }
      this.emit('live-host-gone');
    });
    window.on('closed', () => {
      if (this.liveHost === window) {
        this.liveHost = null;
        this.liveHostReady = false;
      }
    });
    const htmlPath = join(__dirname, '../renderer/live-host.html');
    try {
      if (isDev) {
        await window.loadURL(`${DEV_SERVER_URL}/live-host.html`);
      } else {
        await window.loadFile(htmlPath);
      }
    } catch (error) {
      console.warn('Failed to load live-host.html:', error);
    }
    return window;
  }

  /** The host mounted and can receive commands; flush the pending start/speak. */
  public markLiveHostReady(): void {
    this.liveHostReady = true;
    this.flushLiveHost();
  }

  public startLiveHost(): void {
    const voice = this.configService.getConfig().voice;
    this.pendingLiveHostSpeak = null;
    this.pendingLiveHostStart = {
      bargeInOnSpeakers: voice?.bargeInOnSpeakers === true,
      spokenMaxChars: voice?.liveSpokenMaxChars ?? LIVE_SPOKEN_MAX_CHARS,
      ...(process.env.DESKTOP_ASSISTANT_LIVE_HOST_FAIL === 'mic_denied' ? { failure: 'mic_denied' as const } : {}),
    };
    if (!this.liveHostReady) {
      void this.ensureLiveHost();
    }
    this.flushLiveHost();
  }

  public stopLiveHost(): void {
    this.pendingLiveHostStart = null;
    this.pendingLiveHostSpeak = null;
    this.sendToLiveHost('live-host:stop');
  }

  public speakInLiveHost(text: string, session: number): void {
    this.pendingLiveHostSpeak = { session, generation: (this.liveHostSpeakSeq += 1), text };
    this.flushLiveHost();
  }

  public destroyLiveHost(): void {
    this.liveHostReady = false;
    this.pendingLiveHostStart = null;
    this.pendingLiveHostSpeak = null;
    if (this.liveHost && !this.liveHost.isDestroyed()) {
      this.liveHost.destroy();
    }
    this.liveHost = null;
  }

  private flushLiveHost(): void {
    if (!this.liveHostReady) {
      return;
    }
    const start = this.pendingLiveHostStart;
    if (start) {
      this.pendingLiveHostStart = null;
      this.sendToLiveHost('live-host:start', start);
    }
    const speak = this.pendingLiveHostSpeak;
    if (speak) {
      this.pendingLiveHostSpeak = null;
      this.sendToLiveHost('live-host:speak', speak);
    }
  }

  private sendToLiveHost(channel: string, payload?: unknown): void {
    if (!this.liveHost || this.liveHost.isDestroyed() || !this.liveHostReady) {
      return;
    }
    this.liveHost.webContents.send(channel, payload);
  }

  public destroySpeechOverlay(): void {
    this.cancelSpeechOverlayHide();
    this.hideHubPopover();
    this.hideTransportPopover();
    if (this.speechOverlay && !this.speechOverlay.isDestroyed()) {
      this.speechOverlay.destroy();
    }
    this.speechOverlay = null;
  }

  private bindWindowEvents(window: BrowserWindow, windowType: 'main' | 'settings' | 'desktop' | 'result'): void {
    if (!window) return;

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev
        ? url.startsWith(DEV_SERVER_URL)
        : url.startsWith('file://');
      if (!allowed) {
        event.preventDefault();
        console.warn(`Blocked navigation to ${url}`);
      }
    });

    window.on('closed', () => {
      if (windowType === 'main') {
        this.debouncedSaveWindowPosition();
        this.mainWindow = null;
        this.emit('window-closed');
        } else if (windowType === 'desktop') {
        this.desktopWindow = null;
      } else if (windowType === 'result') {
        this.resultWindow = null;
      } else {
      }
    });

    if (windowType === 'main' || windowType === 'desktop') {
      const refresh = (): void => this.refreshSpeechHud();
      window.on('show', refresh);
      window.on('hide', refresh);
      window.on('minimize', refresh);
      window.on('restore', refresh);
    }

    if (windowType === 'main') {
      window.on('minimize', () => {
        // The launcher has one dismissal verb — hide to tray. Leave the
        // WM minimized state before hiding; hiding a minimized window
        // strands it unmapped on some Linux WMs (Cinnamon/Mutter).
        if (window.isMinimized()) {
          window.restore();
        }
        this.hideMainWindow();
      });

      window.on('close', (event) => {
        if (!this.isAppQuitting) {
          event.preventDefault();
          this.hideMainWindow();
        } else {
        }
      });

      window.on('move', async () => {
        this.debouncedSaveWindowPosition();
      });

      window.on('resize', async () => {
        this.debouncedSaveWindowBounds();
      });
    }

    if (windowType === 'desktop') {
      window.on('close', (event) => {
        if (!this.isAppQuitting) {
          event.preventDefault();
          window.hide();
        }
      });

      window.on('move', () => this.debouncedSaveDesktopBounds());
      window.on('resize', () => this.debouncedSaveDesktopBounds());
      window.on('maximize', () => void this.configService.updateWindowSettings({ desktopMaximized: true }));
      window.on('unmaximize', () => void this.configService.updateWindowSettings({ desktopMaximized: false }));
    }

    if (windowType === 'result') {
      window.on('close', (event) => {
        if (!this.isAppQuitting) {
          event.preventDefault();
          window.hide();
        }
      });
    }

    window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    window.webContents.on('will-navigate', (event, url) => {
      const allowedHosts = [`localhost:${DEV_SERVER_PORT}`];
      const parsedUrl = new URL(url);
      if (!isDev || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'file:')) {
         if (!allowedHosts.includes(parsedUrl.host) && parsedUrl.protocol !== 'file:') {
                  event.preventDefault();
         }
      }
    });
  }

  public showMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createMainWindow();
      return;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }

    // Never show the window off-screen (stale saved state, detached
    // monitor): clamp onto a visible display before every show.
    const [w, h] = this.mainWindow.getSize();
    const [x, y] = this.mainWindow.getPosition();
    const clamped = this.clampToWorkArea(x, y, w, h);
    if (clamped.x !== x || clamped.y !== y) {
      this.mainWindow.setPosition(clamped.x, clamped.y);
      console.log(`Main window re-clamped to visible display at ${clamped.x},${clamped.y}.`);
    }

    // Linux WMs (Cinnamon/Mutter): a window hidden while minimized can stay
    // unmapped after restore()+show(). show() → moveTop() → restore() again
    // re-maps it reliably.
    this.mainWindow.show();
    this.mainWindow.moveTop();
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();

    this.mainWindow.webContents.send('focus-input');
    this.isHidden = false;
    this.emit('window-shown');
  }

  public showSettingsWindow(target?: SettingsOpenTarget): void {
    this.pendingSettingsNav = target ?? null;
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      void this.createSettingsWindow();
      return;
    }

    if (this.settingsWindow.isMinimized()) {
      this.settingsWindow.restore();
    }

    this.settingsWindow.show();
    this.settingsWindow.focus();
    this.isHidden = false;
    this.emit('window-shown');
    this.flushSettingsNav();
  }

  private pendingSettingsNav: SettingsOpenTarget | null = null;

  /** One-shot pull for the deep link that opened the settings window (plan 59). */
  public takePendingSettingsNav(): SettingsOpenTarget | null {
    const target = this.pendingSettingsNav;
    this.pendingSettingsNav = null;
    return target;
  }

  /** Delivers a queued deep-link once the settings renderer can hear it (plan 14 D11). */
  private flushSettingsNav(): void {
    if (!this.pendingSettingsNav) {
      return;
    }
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.webContents.send('settings:navigate', this.pendingSettingsNav);
      this.pendingSettingsNav = null;
    }
  }

  public async createDesktopWindow(conversationId?: string): Promise<BrowserWindow> {
    if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
      this.desktopWindow.focus();
      return this.desktopWindow;
    }

    const savedBounds = this.configService.getWindowSettings().desktopBounds;
    const clampedPos = savedBounds
      ? this.clampToWorkArea(savedBounds.x, savedBounds.y, savedBounds.width, savedBounds.height)
      : null;

    const look = resolveTransparent(this.configService.getConfig().window?.transparent);
    const preloadDesktopPath = join(__dirname, '../preload/preload.generated.js');

    this.desktopWindow = new BrowserWindow({
      width: savedBounds?.width ?? DESKTOP_WINDOW_SIZE.WIDTH,
      height: savedBounds?.height ?? DESKTOP_WINDOW_SIZE.HEIGHT,
      minWidth: DESKTOP_WINDOW_SIZE.MIN_WIDTH,
      minHeight: DESKTOP_WINDOW_SIZE.MIN_HEIGHT,
      x: clampedPos?.x,
      y: clampedPos?.y,
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
      webPreferences: getWebPreferences(isDev, preloadDesktopPath),
      title: 'Desktop Assistant',
    });

    this.desktopWindow.setMenuBarVisibility(false);

    const query: Record<string, string> = { mode: 'desktop' };
    if (conversationId) {
      query.conversation = conversationId;
    }
    if (isDev) {
      const url = new URL(`${DEV_SERVER_URL}/`);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
      await this.desktopWindow.loadURL(url.toString());
    } else {
      const desktopHtmlPath = join(__dirname, '../renderer/index.html');
      await this.desktopWindow.loadFile(desktopHtmlPath, { query });
    }

    this.bindWindowEvents(this.desktopWindow, 'desktop');

    attachRenderCrashRecovery(this.desktopWindow, {
      role: 'desktop',
      recreate: () => {
        if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
          this.desktopWindow.destroy();
        }
        this.desktopWindow = null;
        void this.showDesktopWindow();
      },
    });

    this.desktopWindow.once('ready-to-show', () => {
      if (this.configService.getWindowSettings().desktopMaximized) {
        this.desktopWindow?.maximize();
      }
      this.desktopWindow?.show();
      this.desktopWindow?.focus();
    });

    return this.desktopWindow;
  }

  public async showDesktopWindow(conversationId?: string): Promise<void> {
    if (!this.desktopWindow || this.desktopWindow.isDestroyed()) {
      await this.createDesktopWindow(conversationId);
      return;
    }
    if (this.desktopWindow.isMinimized()) {
      this.desktopWindow.restore();
    }
    this.desktopWindow.show();
    this.desktopWindow.moveTop();
    this.desktopWindow.focus();
    if (conversationId) {
      this.desktopWindow.webContents.send('session-sync', conversationId);
    }
  }

  public getDesktopWindow(): BrowserWindow | null {
    return this.desktopWindow;
  }

  /**
   * Frameless result-viewer window for a stored tool result. Reuses the
   * hidden window for subsequent results (reload with a new `call` param);
   * close hides instead of destroying so the next open is instant.
   */
  public async showResultWindow(callId: string): Promise<BrowserWindow> {
    if (this.resultWindow && !this.resultWindow.isDestroyed()) {
      await this.loadResultContent(this.resultWindow, callId);
      if (this.resultWindow.isMinimized()) {
        this.resultWindow.restore();
      }
      this.resultWindow.show();
      this.resultWindow.moveTop();
      this.resultWindow.focus();
      return this.resultWindow;
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { width: screenWidth, height: screenHeight } = activeDisplay.workArea;
    const width = Math.min(RESULT_WINDOW_SIZE.WIDTH, screenWidth);
    const height = Math.min(RESULT_WINDOW_SIZE.HEIGHT, screenHeight);
    const centerPos = getCenterPosition(width, height, screenWidth, screenHeight);

    const look = resolveTransparent(this.configService.getConfig().window?.transparent);
    const preloadPath = join(__dirname, '../preload/preload.generated.js');

    this.resultWindow = new BrowserWindow({
      width,
      height,
      minWidth: RESULT_WINDOW_SIZE.MIN_WIDTH,
      minHeight: RESULT_WINDOW_SIZE.MIN_HEIGHT,
      x: activeDisplay.workArea.x + centerPos.x,
      y: activeDisplay.workArea.y + centerPos.y,
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
      webPreferences: getWebPreferences(isDev, preloadPath),
      title: 'Desktop Assistant — Tool result',
    });

    this.resultWindow.setMenuBarVisibility(false);
    this.bindWindowEvents(this.resultWindow, 'result');
    attachRenderCrashRecovery(this.resultWindow, { role: 'result' });
    await this.loadResultContent(this.resultWindow, callId);

    this.resultWindow.once('ready-to-show', () => {
      this.resultWindow?.show();
      this.resultWindow?.focus();
    });

    return this.resultWindow;
  }

  private async loadResultContent(window: BrowserWindow, callId: string): Promise<void> {
    const query = { call: callId };
    if (isDev) {
      const url = new URL(`${DEV_SERVER_URL}/result-viewer.html`);
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
      await window.loadURL(url.toString());
    } else {
      const htmlPath = join(__dirname, '../renderer/result-viewer.html');
      await window.loadFile(htmlPath, { query });
    }
  }

  public getResultWindow(): BrowserWindow | null {
    return this.resultWindow;
  }

  private debouncedSaveDesktopBounds(): void {
    if (this.saveDesktopBoundsDebounce) {
      clearTimeout(this.saveDesktopBoundsDebounce);
    }
    this.saveDesktopBoundsDebounce = setTimeout(async () => {
      if (!this.desktopWindow || this.desktopWindow.isDestroyed()) {
        return;
      }
      const bounds = this.desktopWindow.getNormalBounds();
      const clamped = this.clampToWorkArea(bounds.x, bounds.y, bounds.width, bounds.height);
      await this.configService.updateWindowSettings({
        desktopBounds: { ...bounds, x: clamped.x, y: clamped.y },
      });
    }, TIMING.WINDOW_SAVE_DEBOUNCE);
  }

  public hideMainWindow(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
       if (this.mainWindow.isVisible()) {
         this.saveCurrentPosition();
         this.saveWindowBounds();
       }
      // Leave the WM minimized state before hiding — hiding a minimized
      // window strands it unmapped on some Linux WMs (Cinnamon/Mutter).
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.hide();
      this.isHidden = true;
      this.emit('window-hidden');
      }
  }

  public hideDesktopWindow(): void {
    if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
      this.desktopWindow.hide();
    }
  }

  public toggleMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      if (this.configService.getConfig().behavior?.defaultMode === 'desktop') {
        void this.showDesktopWindow();
        return;
      }
      this.createMainWindow();
      return;
    }

    if (this.isHidden || !this.mainWindow.isVisible() || this.mainWindow.isMinimized()) {
      if (this.configService.getConfig().behavior?.defaultMode === 'desktop' && this.isHidden) {
        void this.showDesktopWindow();
        return;
      }
      this.showMainWindow();
    } else {
      this.hideMainWindow();
    }
  }

  /**
   * True when a chat surface is actually on screen. A minimized window still
   * reports `isVisible()` on Linux, and the launcher converts minimize into
   * hide-to-tray, so minimized must not count as "the user is looking at the
   * launcher".
   */
  public areChatWindowsVisible(): boolean {
    const active = (window: BrowserWindow | null): boolean =>
      !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    return active(this.mainWindow) || active(this.desktopWindow);
  }

  /** Hide every chat surface at once (the live HUD handoff). */
  public hideChatWindows(): void {
    this.hideMainWindow();
    if (this.desktopWindow && !this.desktopWindow.isDestroyed() && this.desktopWindow.isVisible()) {
      this.desktopWindow.hide();
    }
  }

  public resizeMainWindow(width: number|null, height: number|null): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    const [currentWidth, currentHeight] = this.mainWindow.getSize();
    if (width === null) width = currentWidth;
    if (height === null) height = currentHeight;
    // With `resizable: false` Electron reports the current size as the
    // maximum on X11, so the window's own max hints must not be consulted
    // here — every growth request would clamp down to the current size.
    const { adjustedWidth: targetWidth, adjustedHeight: targetHeight } = validateDimensions(width, height);
    if (!resizeTargetChanged(
      { width: currentWidth, height: currentHeight },
      { width: targetWidth, height: targetHeight }
    )) {
      return;
    }

    if (process.platform === 'darwin') {
      this.mainWindow.setSize(targetWidth, targetHeight, true);
      return;
    }

    const [x, y] = this.mainWindow.getPosition();
    this.mainWindow.setBounds({ x, y, width: targetWidth, height: targetHeight });
  }

  beginCornerResize(corner: ResizeCorner): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    const [x, y] = this.mainWindow.getPosition();
    const [width, height] = this.mainWindow.getSize();
    this.cornerResize = { corner, x, y, width, height };
  }

  updateCornerResize(dx: number, dy: number): void {
    if (!this.cornerResize || !this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    const start = this.cornerResize;
    const workArea = screen.getDisplayMatching(start).workArea;
    this.mainWindow.setBounds(computeCornerResizeBounds(start, start.corner, dx, dy, workArea));
  }

  endCornerResize(): void {
    this.cornerResize = null;
  }

  moveMainWindowBy(dx: number, dy: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    const [x, y] = this.mainWindow.getPosition();
    const [width, height] = this.mainWindow.getSize();
    const workArea = screen.getDisplayMatching({ x, y, width, height }).workArea;
    const moved = computeMovedPosition(x, y, dx, dy, width, height, workArea);
    if (moved.x !== x || moved.y !== y) {
      this.mainWindow.setPosition(moved.x, moved.y);
    }
  }

  public centerWindow(window: BrowserWindow | null): void {
    if (window && !window.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const [windowWidth, windowHeight] = window.getSize();

      const x = Math.round((screenWidth - windowWidth) / 2);
      const y = Math.round((screenHeight - windowHeight) / 2);

      window.setPosition(x, y);
      }
  }

  public async recreateMainWindow(): Promise<BrowserWindow> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.saveCurrentPosition();
      this.saveWindowBounds();
      this.mainWindow.destroy();
      this.mainWindow = null;
    }
    const created = await this.createMainWindow();
    await this.loadApp();
    return created;
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  public getSettingsWindow(): BrowserWindow | null {
    return this.settingsWindow;
  }

  private isQuitting(): boolean {
    return (global as any).isQuitting === true;
  }

  public setQuitting(quitting: boolean): void {
    (global as any).isQuitting = quitting;
    console.log(`Application quitting state set to: ${quitting}`);
  }

  public destroy(): void {
    if (this.saveDesktopBoundsDebounce) {
      clearTimeout(this.saveDesktopBoundsDebounce);
      this.saveDesktopBoundsDebounce = null;
    }
    if (this.savePositionDebounce) {
      clearTimeout(this.savePositionDebounce);
      this.savePositionDebounce = null;
    }
    if (this.saveBoundsDebounce) {
      clearTimeout(this.saveBoundsDebounce);
      this.saveBoundsDebounce = null;
    }

    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
      this.settingsWindow = null;
      }
    if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
      this.desktopWindow.destroy();
      this.desktopWindow = null;
    }
    if (this.resultWindow && !this.resultWindow.isDestroyed()) {
      this.resultWindow.destroy();
      this.resultWindow = null;
    }
    this.destroySpeechOverlay();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
      this.mainWindow = null;
    }
  }

  /**
   * Clamp a window position so the window stays on a visible display's
   * work area (multi-monitor aware: a position on a secondary display is
   * valid). Positions entirely off-screen are pulled onto the display
   * nearest the cursor.
   */
  private clampToWorkArea(x: number, y: number, width: number, height: number): { x: number; y: number } {
    const intersects = (wx: number, wy: number, ww: number, wh: number): boolean =>
      x + width > wx && x < wx + ww && y + height > wy && y < wy + wh;

    const onAnyDisplay = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return intersects(area.x, area.y, area.width, area.height);
    });
    if (onAnyDisplay) {
      return { x, y };
    }

    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const clampedX = Math.max(area.x, Math.min(x, area.x + Math.max(0, area.width - width)));
    const clampedY = Math.max(area.y, Math.min(y, area.y + Math.max(0, area.height - height)));
    return { x: clampedX, y: clampedY };
  }

  private async saveCurrentPosition() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) return;

    const [x, y] = this.mainWindow.getPosition();
    const [width, height] = this.mainWindow.getSize();
    const clamped = this.clampToWorkArea(x, y, width, height);
    if (clamped.x !== x || clamped.y !== y) {
      console.warn(`Attempted to save off-screen position: x=${x}, y=${y}. Saving clamped ${clamped.x},${clamped.y}.`);
    }

    try {
      await this.configService.updateWindowSettings({
        position: { x: clamped.x, y: clamped.y }
      });
    } catch (error) {
      console.error('Failed to save main window position:', error);
    }
  }

  public async saveWindowBounds(): Promise<void> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
       if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) return;
      const bounds = this.mainWindow.getBounds();
      const clamped = this.clampToWorkArea(bounds.x, bounds.y, bounds.width, bounds.height);
      await this.configService.updateWindowBounds({ ...bounds, x: clamped.x, y: clamped.y });
    }
  }

  private debouncedSaveWindowPosition() {
    if (this.savePositionDebounce) {
      clearTimeout(this.savePositionDebounce);
    }
    this.savePositionDebounce = setTimeout(() => {
      this.saveCurrentPosition();
    }, TIMING.WINDOW_SAVE_DEBOUNCE);
  }

  private debouncedSaveWindowBounds(): void {
    if (this.saveBoundsDebounce) {
      clearTimeout(this.saveBoundsDebounce);
    }

    this.saveBoundsDebounce = setTimeout(async () => {
      await this.saveWindowBounds();
    }, TIMING.WINDOW_SAVE_DEBOUNCE);
  }
}