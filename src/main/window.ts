import { app, BrowserWindow, screen, shell, nativeImage } from 'electron';
import { join } from 'path';
import { EventEmitter } from 'events';
import {
  WINDOW_SIZE,
  getWindowSize,
  validateDimensions,
  computeCornerResizeBounds,
  computeMovedPosition,
  getCenterPosition,
  getWebPreferences
} from '@shared/constants/index';
import { getAssetsPath, isDev } from '@main/utils/config';
import { MainConfigService } from '@main/services/ConfigService';
import { TIMING } from '@shared/constants/timing.js';
import { WindowState, type ResizeCorner } from '@shared/types';
import { easeStep } from '@main/windowAnim';

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
  private isHidden = false;
  private isAppQuitting = false;
  private configService = MainConfigService.getInstance();
  private savePositionDebounce: NodeJS.Timeout | null = null;
  private saveBoundsDebounce: NodeJS.Timeout | null = null;
  private saveDesktopBoundsDebounce: NodeJS.Timeout | null = null;
  private resizeTimer: NodeJS.Timeout | null = null;
  private resizeTarget: { width: number; height: number } | null = null;
  private cornerResize: ({ corner: ResizeCorner } & { x: number; y: number; width: number; height: number }) | null = null;

  constructor() {
    super();
    app.on('before-quit', () => {
      console.log('WindowManager detected app is quitting.');
      this.isAppQuitting = true;
    });
  }

  async createMainWindow(): Promise<BrowserWindow> {
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
    const preloadMainPath = join(__dirname, '../preload/preload.js');

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

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
      this.mainWindow?.focus();
      console.log('Main window is ready to show and focused.');
    });

    return this.mainWindow;
  }
  async loadApp(){
    if (!this.mainWindow) return;

    if (isDev) {
      console.log('Main window loading URL: http://localhost:5173');
      await this.mainWindow.loadURL('http://localhost:5173');
    } else {
      const mainHtmlPath = join(__dirname, '../renderer/index.html');
      console.log(`Main window loading file: ${mainHtmlPath}`);
      await this.mainWindow.loadFile(mainHtmlPath);
    }
  }

  async createSettingsWindow(): Promise<BrowserWindow> {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      console.log('Settings window already exists, focusing.');
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

    const preloadSettingsPath = join(__dirname, '../preload/preload.js');
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
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      maximizable: true,
      minimizable: true,
      modal: false,
      hasShadow: !settingsLook.transparent,
      webPreferences: getWebPreferences(isDev, preloadSettingsPath),
      title: 'Desktop Assistant Settings',
    });

    this.settingsWindow.setMenuBarVisibility(false);

    const settingsHtmlPath = join(__dirname, '../renderer/settings.html');
    if (isDev) {
      console.log(`Settings window loading URL: http://localhost:5173/settings.html (If configured in Vite) or directly loading file: ${settingsHtmlPath}`);
      try {
        await this.settingsWindow.loadURL('http://localhost:5173/settings.html');
      } catch {
        console.warn('Failed to load settings.html from dev server, trying file path...');
        await this.settingsWindow.loadFile(settingsHtmlPath);
      }
    } else {
      console.log(`Settings window loading file: ${settingsHtmlPath}`);
      await this.settingsWindow.loadFile(settingsHtmlPath);
    }

    this.bindWindowEvents(this.settingsWindow, 'settings');

    this.settingsWindow.once('ready-to-show', () => {
      this.settingsWindow?.show();
      this.settingsWindow?.focus();
      this.flushSettingsNav();
      console.log('Settings window is ready to show and focused.');
    });

    this.settingsWindow.on('closed', () => {
      console.log('Settings window closed.');
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  private bindWindowEvents(window: BrowserWindow, windowType: 'main' | 'settings' | 'desktop' | 'result'): void {
    if (!window) return;

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const allowed = isDev
        ? url.startsWith('http://localhost:5173')
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
        console.log('Main window event: closed');
      } else if (windowType === 'desktop') {
        this.desktopWindow = null;
        console.log('Desktop window event: closed');
      } else if (windowType === 'result') {
        this.resultWindow = null;
        console.log('Result window event: closed');
      } else {
        console.log('Settings window event: closed');
      }
    });

    if (windowType === 'main') {
      window.on('minimize', () => {
        console.log('Main window event: minimize');
        // Leave the WM minimized state before hiding — hiding a minimized
        // window strands it unmapped on some Linux WMs (Cinnamon/Mutter).
        if (window.isMinimized()) {
          window.restore();
        }
        this.hideMainWindow();
      });

      window.on('close', (event) => {
        if (!this.isAppQuitting) {
          event.preventDefault();
          this.hideMainWindow();
          console.log('Main window event: close intercepted, hiding.');
        } else {
          console.log('Main window event: close allowed (app quitting).');
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
          console.log('Desktop window event: close intercepted, hiding.');
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
          console.log('Result window event: close intercepted, hiding.');
        }
      });
    }

    window.webContents.setWindowOpenHandler(({ url }) => {
      console.log(`${windowType} window event: opening external link ${url}`);
      shell.openExternal(url);
      return { action: 'deny' };
    });

    window.webContents.on('will-navigate', (event, url) => {
      const allowedHosts = ['localhost:5173'];
      const parsedUrl = new URL(url);
      if (!isDev || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'file:')) {
         if (!allowedHosts.includes(parsedUrl.host) && parsedUrl.protocol !== 'file:') {
            console.log(`${windowType} window event: navigation prevented to ${url}`);
            event.preventDefault();
         }
      }
    });
  }

  public showMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      console.log('Main window does not exist or is destroyed, creating new one.');
      this.createMainWindow();
      return;
    }

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
      console.log('Main window restored from minimized state.');
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
    console.log('Main window shown and focused.');
  }

  public showSettingsWindow(target?: { tab?: string; commandId?: string }): void {
    this.pendingSettingsNav = target ?? null;
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) {
      console.log('Settings window does not exist or is destroyed, creating new one.');
      void this.createSettingsWindow();
      return;
    }

    if (this.settingsWindow.isMinimized()) {
      this.settingsWindow.restore();
      console.log('Settings window restored from minimized state.');
    }

    this.settingsWindow.show();
    this.settingsWindow.focus();
    this.isHidden = false;
    this.emit('window-shown');
    this.flushSettingsNav();
    console.log('Settings window shown and focused.');
  }

  private pendingSettingsNav: { tab?: string; commandId?: string } | null = null;

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
    const preloadDesktopPath = join(__dirname, '../preload/preload.js');

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
      const url = new URL('http://localhost:5173/');
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
      await this.desktopWindow.loadURL(url.toString());
    } else {
      const desktopHtmlPath = join(__dirname, '../renderer/index.html');
      await this.desktopWindow.loadFile(desktopHtmlPath, { query });
    }

    this.bindWindowEvents(this.desktopWindow, 'desktop');

    this.desktopWindow.once('ready-to-show', () => {
      if (this.configService.getWindowSettings().desktopMaximized) {
        this.desktopWindow?.maximize();
      }
      this.desktopWindow?.show();
      this.desktopWindow?.focus();
      console.log('Desktop window is ready to show and focused.');
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
    const preloadPath = join(__dirname, '../preload/preload.js');

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
      const url = new URL('http://localhost:5173/result-viewer.html');
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
      this.mainWindow.hide();
      this.isHidden = true;
      this.emit('window-hidden');
      console.log('Main window hidden.');
    }
  }

  public toggleMainWindow(): void {
    console.log("toggleMainWindow")
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

  /** True when the launcher or the desktop window is visible. */
  public areChatWindowsVisible(): boolean {
    const mainVisible = !!this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible();
    const desktopVisible = !!this.desktopWindow && !this.desktopWindow.isDestroyed() && this.desktopWindow.isVisible();
    return mainVisible || desktopVisible;
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
    if (process.env.NODE_ENV === 'development') {
      console.log(`[resize] request ${width}x${height} -> clamped ${targetWidth}x${targetHeight} (current ${currentWidth}x${currentHeight})`);
    }
    if (targetWidth === currentWidth && targetHeight === currentHeight) {
      return;
    }

    if (process.platform === 'darwin') {
      this.mainWindow.setSize(targetWidth, targetHeight, true);
      return;
    }

    this.resizeTarget = { width: targetWidth, height: targetHeight };
    if (!this.resizeTimer) {
      this.resizeTimer = setInterval(() => this.tickResize(), 16);
    }
  }

  private tickResize(): void {
    const mainWindow = this.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      this.stopResize();
      return;
    }
    const target = this.resizeTarget;
    if (!target) {
      this.stopResize();
      return;
    }
    const [currentWidth, currentHeight] = mainWindow.getSize();
    const [currentX, currentY] = mainWindow.getPosition();
    const next = {
      width: easeStep(currentWidth, target.width),
      height: easeStep(currentHeight, target.height),
    };
    const apply = (width: number, height: number): void => {
      mainWindow.setBounds({ x: currentX, y: currentY, width, height });
    };
    if (next.width === target.width && next.height === target.height) {
      apply(target.width, target.height);
      this.stopResize();
      return;
    }
    apply(Math.round(next.width), Math.round(next.height));
  }

  private stopResize(): void {
    if (this.resizeTimer) {
      clearInterval(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.resizeTarget = null;
  }

  beginCornerResize(corner: ResizeCorner): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.stopResize();
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
      console.log(`Window centered at: x=${x}, y=${y}`);
    }
  }

  public async recreateMainWindow(): Promise<BrowserWindow> {
    console.log('[window] recreating main window (window-look change)');
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

  public isWindowVisible(): boolean {
    return this.mainWindow ? this.mainWindow.isVisible() && !this.mainWindow.isMinimized() : false;
  }

  private isQuitting(): boolean {
    return (global as any).isQuitting === true;
  }

  public setQuitting(quitting: boolean): void {
    (global as any).isQuitting = quitting;
    console.log(`Application quitting state set to: ${quitting}`);
  }

  public destroy(): void {
    console.log('WindowManager destroying all windows...');
    this.stopResize();
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
      console.log('Settings window destroyed.');
    }
    if (this.desktopWindow && !this.desktopWindow.isDestroyed()) {
      this.desktopWindow.destroy();
      this.desktopWindow = null;
      console.log('Desktop window destroyed.');
    }
    if (this.resultWindow && !this.resultWindow.isDestroyed()) {
      this.resultWindow.destroy();
      this.resultWindow = null;
      console.log('Result window destroyed.');
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
      this.mainWindow = null;
      console.log('Main window destroyed.');
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
      console.log(`Main window position saved: x=${clamped.x}, y=${clamped.y}`);
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
      console.log(`Main window bounds saved: ${JSON.stringify({ ...bounds, x: clamped.x, y: clamped.y })}`);
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