import { ipcMain } from 'electron';
import type { HotkeySettings } from '@shared/types';
import type { HotkeyService } from '@main/services/HotkeyService';

/** Every channel this module registers (the teardown list consumes this). */
export const HOTKEYS_IPC_CHANNELS: string[] = [
  'hotkeys:get-settings', 'hotkeys:save-settings', 'hotkeys:register-all',
  'hotkeys:start-recording', 'hotkeys:stop-recording',
];

export interface HotkeysIpcDeps {
  hotkeyService: HotkeyService;
}

export function registerHotkeysIpc(deps: HotkeysIpcDeps): void {
  const { hotkeyService } = deps;

  ipcMain.handle('hotkeys:get-settings', async () => {
    return hotkeyService.getSettings();
  });

  ipcMain.handle('hotkeys:save-settings', async (event, settings: Partial<HotkeySettings>) => {
    try {
      await hotkeyService.saveAndReloadHotkeys(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save hotkey settings:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('hotkeys:register-all', async () => {
    hotkeyService.registerAll();
  });

  ipcMain.handle('hotkeys:start-recording', async (_event) => {
    return null;
  });

  ipcMain.handle('hotkeys:stop-recording', async () => {
  });
}
