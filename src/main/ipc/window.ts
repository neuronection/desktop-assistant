import { ipcMain, BrowserWindow } from 'electron';
import { isResizeCorner, type ResizeCorner } from '@shared/types';
import type { WindowManager } from '@main/window';

/** Every channel this module registers (the teardown list consumes this). */
export const WINDOW_IPC_CHANNELS: string[] = [
  'window:resize', 'window:resize-corner-start', 'window:resize-corner-update', 'window:resize-corner-end',
  'window:move-by', 'window:hide', 'window:show', 'window:minimize', 'window:close',
  'window:set-always-on-top', 'window:maximize', 'desktop:open', 'desktop:open-launcher',
];

export interface WindowIpcDeps {
  windowManager: WindowManager;
}

export function registerWindowIpc(deps: WindowIpcDeps): void {
  const { windowManager } = deps;

  ipcMain.handle('window:resize', async (event, width: number|null, height: number|null) => {
    windowManager.resizeMainWindow(width, height);
  });

  ipcMain.handle('window:resize-corner-start', async (_event, corner: ResizeCorner) => {
    if (!isResizeCorner(corner)) {
      throw new Error(`Invalid resize corner: ${String(corner)}`);
    }
    windowManager.beginCornerResize(corner);
  });

  ipcMain.handle('window:resize-corner-update', async (_event, dx: number, dy: number) => {
    windowManager.updateCornerResize(dx, dy);
  });

  ipcMain.handle('window:resize-corner-end', async () => {
    windowManager.endCornerResize();
  });

  ipcMain.handle('window:move-by', async (_event, dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error(`Invalid move deltas: ${String(dx)}, ${String(dy)}`);
    }
    windowManager.moveMainWindowBy(Math.trunc(dx), Math.trunc(dy));
  });

  ipcMain.handle('window:hide', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.hide();
    }
  });

  ipcMain.handle('window:show', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.show();
      window.focus();
    }
  });

  ipcMain.handle('window:minimize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.minimize();
    }
  });

  ipcMain.handle('window:close', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.close();
    }
  });

  ipcMain.handle('window:set-always-on-top', async (event, flag: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.setAlwaysOnTop(flag);
    }
  });

  ipcMain.handle('window:maximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.handle('desktop:open', async (event, conversationId?: string) => {
    windowManager.hideMainWindow();
    await windowManager.showDesktopWindow(conversationId);
  });

  ipcMain.handle('desktop:open-launcher', (event, mode?: 'compact' | 'expanded', conversationId?: string) => {
    windowManager.hideDesktopWindow();
    windowManager.showMainWindow();
    const main = windowManager.getMainWindow();
    if (!main || main.isDestroyed()) return;
    if (conversationId) {
      main.webContents.send('session-sync', conversationId);
    }
    main.webContents.send('launcher:set-mode', mode ?? 'compact');
  });
}
