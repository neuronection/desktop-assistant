import type { HotkeySettings } from '@shared/types';
import type { HotkeyService } from '@main/services/HotkeyService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface HotkeysIpcDeps {
  hotkeyService: HotkeyService;
}

export function registerHotkeysIpc(deps: HotkeysIpcDeps): void {
  const { hotkeyService } = deps;

  register(IPC['hotkeys:get-settings'], async () => {
    return hotkeyService.getSettings();
  });

  register(IPC['hotkeys:save-settings'], async (event, settings: Partial<HotkeySettings>) => {
    try {
      await hotkeyService.saveAndReloadHotkeys(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save hotkey settings:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  register(IPC['hotkeys:register-all'], async () => {
    hotkeyService.registerAll();
  });

  register(IPC['hotkeys:start-recording'], async (_event) => {
    return null;
  });

  register(IPC['hotkeys:stop-recording'], async () => {
  });
}
