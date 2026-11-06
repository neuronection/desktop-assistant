import { BrowserWindow, desktopCapturer, screen, Menu, clipboard, dialog, shell, app } from 'electron';
import { writeFile, readFile, stat } from 'fs/promises';
import { resolveWithinGrantedRoots } from '@main/ai/tools/policy';
import { EXECUTABLE_EXTENSIONS } from '@main/ai/tools/native/open-path';
import type { AutostartStatus } from '@shared/types';
import { ResidencyService } from '@main/services/ResidencyService';
import type { ClipboardChange, DesktopContextService, SelectionResult } from '@main/services/DesktopContextService';
import type { ToolPolicyEngine } from '@main/ai/tools/policy';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface SystemIpcDeps {
  desktopContext: DesktopContextService;
  toolPolicy: ToolPolicyEngine;
  notify(input: {
    kind: 'system';
    severity: 'info' | 'success' | 'warn' | 'error';
    title: string;
    body: string;
    clickAction: 'none';
  }): Promise<{ suppressed: boolean } | null>;
}

export function registerSystemIpc(deps: SystemIpcDeps): void {
  const { desktopContext, toolPolicy } = deps;

  register(IPC['get-screen-sources'], async (_event) => {
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

  register(IPC['capture-high-res-source'], async (event, sourceId: string) => {
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

  register(IPC['desktop:selection-supported'], async (): Promise<boolean> => {
    return desktopContext.selectionSupported();
  });

  register(IPC['desktop:clipboard-changed'], async (): Promise<ClipboardChange> => {
    return desktopContext.clipboardChanged();
  });

  register(IPC['desktop:capture-selection'], async (): Promise<SelectionResult> => {
    return desktopContext.captureSelection();
  });

  register(IPC['fs:save-file'], async (event, options: {
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

  register(IPC['fs:open-file'], async (event, options?: {
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

  register(IPC['system:show-context-menu'], (event) => {
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

  register(IPC['system:get-app-version'], () => {
    return app.getVersion();
  });

  register(IPC['system:get-platform'], () => {
    return process.platform;
  });

  register(IPC['system:autostart-status'], (): AutostartStatus => {
    return ResidencyService.getInstance().getStatus();
  });

  register(IPC['system:open-external'], async (event, url: string) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('Failed to open external URL:', error);
      return false;
    }
  });

  register(IPC['system:show-item-in-folder'], (event, path: string) => {
    shell.showItemInFolder(path);
  });

  register(IPC['system:open-path'], async (_event, path: string): Promise<string | null> => {
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

  register(IPC['clipboard:write-text'], async (_event, text: string) => {
    try {
      await clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to write to clipboard:', error);
      return false;
    }
  });

  register(IPC['clipboard:read-text'], async () => {
    try {
      return await clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return '';
    }
  });

  register(IPC['notification:show'], async (_event, title: string, body: string) => {
    const result = await deps.notify({
      kind: 'system',
      severity: 'info',
      title,
      body,
      clickAction: 'none',
    });
    return result !== null && !result.suppressed;
  });

}
