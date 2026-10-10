import { ipcMain, BrowserWindow } from 'electron';

/** Every channel this module registers (the teardown list consumes this). */
export const DEV_IPC_CHANNELS: string[] = [
  'dev:open-devtools', 'dev:reload', 'log:error', 'log:info', 'log:warn',
];

export function registerDevIpc(): void {
  ipcMain.handle('dev:open-devtools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && process.env.NODE_ENV === 'development') {
      window.webContents.openDevTools();
    }
  });

  ipcMain.handle('dev:reload', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && process.env.NODE_ENV === 'development') {
      window.webContents.reload();
    }
  });

  ipcMain.handle('log:error', (event, error: any) => {
    console.error('Renderer Error:', error);
  });

  ipcMain.handle('log:info', (event, message: string) => {
    console.log('Renderer Info:', message);
  });

  ipcMain.handle('log:warn', (event, message: string) => {
    console.warn('Renderer Warning:', message);
  });
}
