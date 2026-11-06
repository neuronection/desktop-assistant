import { BrowserWindow } from 'electron';
import { isResizeCorner, type ResizeCorner } from '@shared/types';
import type { WindowManager } from '@main/window';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface WindowIpcDeps {
  windowManager: WindowManager;
}

export function registerWindowIpc(deps: WindowIpcDeps): void {
  const { windowManager } = deps;

  register(IPC['window:resize'], async (event, width: number|null, height: number|null) => {
    windowManager.resizeMainWindow(width, height);
  });

  register(IPC['window:resize-corner-start'], async (_event, corner: ResizeCorner) => {
    if (!isResizeCorner(corner)) {
      throw new Error(`Invalid resize corner: ${String(corner)}`);
    }
    windowManager.beginCornerResize(corner);
  });

  register(IPC['window:resize-corner-update'], async (_event, dx: number, dy: number) => {
    windowManager.updateCornerResize(dx, dy);
  });

  register(IPC['window:resize-corner-end'], async () => {
    windowManager.endCornerResize();
  });

  register(IPC['window:move-by'], async (_event, dx: number, dy: number) => {
    windowManager.moveMainWindowBy(Math.trunc(dx), Math.trunc(dy));
  });

  register(IPC['window:hide'], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.hide();
    }
  });

  register(IPC['window:show'], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.show();
      window.focus();
    }
  });

  register(IPC['window:minimize'], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.minimize();
    }
  });

  register(IPC['window:close'], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      window.close();
    }
  });

  register(IPC['window:maximize'], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  register(IPC['desktop:open'], async (event, conversationId?: string) => {
    windowManager.hideMainWindow();
    await windowManager.showDesktopWindow(conversationId);
  });

  register(IPC['desktop:open-launcher'], (event, mode?: 'compact' | 'expanded', conversationId?: string) => {
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
