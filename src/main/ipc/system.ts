import { ipcMain, BrowserWindow, desktopCapturer, screen, Menu, clipboard, Notification, dialog, shell, app } from 'electron';
import { writeFile, readFile, stat } from 'fs/promises';
import { resolveWithinGrantedRoots } from '@main/ai/tools/policy';
import { EXECUTABLE_EXTENSIONS } from '@main/ai/tools/native/open-path';
import type { AutostartStatus } from '@shared/types';
import { ResidencyService } from '@main/services/ResidencyService';
import type { ClipboardChange, DesktopContextService, SelectionResult } from '@main/services/DesktopContextService';
import type { ToolPolicyEngine } from '@main/ai/tools/policy';

/** Every channel this module registers (the teardown list consumes this). */
export const SYSTEM_IPC_CHANNELS: string[] = [
  'get-screen-sources', 'capture-high-res-source',
  'desktop:selection-supported', 'desktop:clipboard-changed', 'desktop:capture-selection',
  'system:show-context-menu', 'system:get-app-version', 'system:get-platform', 'system:autostart-status',
  'system:get-arch', 'system:open-external', 'system:show-item-in-folder', 'system:open-path', 'system:quit-app',
  'clipboard:write-text', 'clipboard:read-text', 'notification:show',
  'dialog:show-message', 'dialog:show-error', 'fs:save-file', 'fs:open-file',
];

export interface SystemIpcDeps {
  desktopContext: DesktopContextService;
  toolPolicy: ToolPolicyEngine;
}

export function registerSystemIpc(deps: SystemIpcDeps): void {
  const { desktopContext, toolPolicy } = deps;

  ipcMain.handle('get-screen-sources', async (_event) => {
    const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 300, height: 300 }
    });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  });

  ipcMain.handle('capture-high-res-source', async (event, sourceId: string) => {
    if (!sourceId) {
      throw new Error('Source ID is required');
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const requiredSize = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: {
        width: requiredSize.width,
        height: requiredSize.height
      }
    });

    const selectedSource = sources.find(s => s.id === sourceId);

    if (!selectedSource) {
      throw new Error(`Source with ID "${sourceId}" not found or has been closed.`);
    }

    return selectedSource.thumbnail.toDataURL();
  });

  ipcMain.handle('desktop:selection-supported', async (): Promise<boolean> => {
    return desktopContext.selectionSupported();
  });

  ipcMain.handle('desktop:clipboard-changed', async (): Promise<ClipboardChange> => {
    return desktopContext.clipboardChanged();
  });

  ipcMain.handle('desktop:capture-selection', async (): Promise<SelectionResult> => {
    return desktopContext.captureSelection();
  });

  ipcMain.handle('fs:save-file', async (event, options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    content: string;
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    try {
      const result = await dialog.showSaveDialog(window, {
        title: options.title || 'Save File',
        defaultPath: options.defaultPath,
        filters: options.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePath) {
        await writeFile(result.filePath, options.content);
        return result.filePath;
      }

      return null;
    } catch (error) {
      console.error('Failed to save file:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:open-file', async (event, options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: ('openFile' | 'multiSelections')[];
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    try {
      const result = await dialog.showOpenDialog(window, {
        title: options?.title || 'Open File',
        filters: options?.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: options?.properties || ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const content = await readFile(filePath, 'utf-8');
        return { filePath, content };
      }

      return null;
    } catch (error) {
      console.error('Failed to open file:', error);
      throw error;
    }
  });

  ipcMain.handle('system:show-context-menu', (event) => {
    const template = [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' }
    ];
    // @ts-expect-error template role union does not satisfy Electron's MenuItemConstructorOptions
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
  });

  ipcMain.handle('system:get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('system:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('system:autostart-status', (): AutostartStatus => {
    return ResidencyService.getInstance().getStatus();
  });

  ipcMain.handle('system:get-arch', () => {
    return process.arch;
  });

  ipcMain.handle('system:open-external', async (event, url: string) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('Failed to open external URL:', error);
      return false;
    }
  });

  ipcMain.handle('system:show-item-in-folder', (event, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle('system:open-path', async (_event, path: string): Promise<string | null> => {
    if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
      return 'Invalid path.';
    }
    const info = await stat(path).catch(() => null);
    if (!info) {
      return `'${path}' does not exist.`;
    }
    if (!info.isDirectory()) {
      const lower = path.toLowerCase();
      if ([...EXECUTABLE_EXTENSIONS].some((ext) => lower.endsWith(ext))) {
        return 'Executable files cannot be opened.';
      }
      if (resolveWithinGrantedRoots(toolPolicy.grantedRoots() ?? [], path) === null) {
        return `'${path}' is outside the folders the user approved. Grant that folder in Settings → Tools to open files from it.`;
      }
    }
    const error = await shell.openPath(path);
    return error || null;
  });

  ipcMain.handle('system:quit-app', () => {
    app.quit();
  });

  ipcMain.handle('clipboard:write-text', async (_event, text: string) => {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to write to clipboard:', error);
      return false;
    }
  });

  ipcMain.handle('clipboard:read-text', async () => {
    try {
      return await clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return '';
    }
  });

  ipcMain.handle('notification:show', (event, options: {
    title: string;
    body: string;
    silent?: boolean;
    urgency?: 'normal' | 'critical' | 'low';
  }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent || false,
        urgency: options.urgency || 'normal'
      });

      notification.show();
      return true;
    }

    return false;
  });

  ipcMain.handle('dialog:show-message', async (event, options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning';
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
  }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { response: -1 };

    try {
      const result = await dialog.showMessageBox(window, {
        type: options.type || 'info',
        title: options.title || 'Message',
        message: options.message,
        detail: options.detail,
        buttons: options.buttons || ['OK'],
        defaultId: options.defaultId || 0,
        cancelId: options.cancelId
      });

      return result;
    } catch (error) {
      console.error('Failed to show message dialog:', error);
      return { response: -1 };
    }
  });

  ipcMain.handle('dialog:show-error', async (event, title: string, content: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    try {
      await dialog.showErrorBox(title, content);
    } catch (error) {
      console.error('Failed to show error dialog:', error);
    }
  });
}
