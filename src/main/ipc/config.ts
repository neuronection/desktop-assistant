import { ipcMain, BrowserWindow } from 'electron';
import type { AppConfig } from '@shared/config/AppConfig';
import type { Settings, SettingsOpenTarget } from '@shared/types';
import { ResidencyService } from '@main/services/ResidencyService';
import type { MainConfigService } from '@main/services/ConfigService';
import type { WindowManager } from '@main/window';
import type { HotkeyService } from '@main/services/HotkeyService';

/** Every channel this module registers (the teardown list consumes this). */
export const CONFIG_IPC_CHANNELS: string[] = [
  'config:load', 'config:save', 'config:reset', 'config:export', 'config:get-path', 'config:import',
  'settings:open', 'settings:save',
];

export interface ConfigIpcDeps {
  configService: MainConfigService;
  windowManager: WindowManager;
  hotkeyService: HotkeyService;
}

export function registerConfigIpc(deps: ConfigIpcDeps): void {
  const { configService, windowManager, hotkeyService } = deps;

  ipcMain.handle('config:load', async () => {
    try {
      return configService.getConfig();
    } catch (error) {
      console.error('Failed to load config via IPC:', error);
      return null;
    }
  });

  ipcMain.handle('config:save', async (event, config: Partial<AppConfig>) => {
    try {
      const previousTransparent = configService.getConfig().window?.transparent;
      const previousAutostart = configService.getConfig().preferences?.autostart ?? false;
      await configService.updateConfig(config);

      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('config-updated', config);
      });

      if (config.window && config.window.transparent !== previousTransparent) {
        void windowManager.recreateMainWindow();
      }

      const nextAutostart = configService.getConfig().preferences?.autostart ?? false;
      if (nextAutostart !== previousAutostart) {
        ResidencyService.getInstance().apply(nextAutostart);
      }

      hotkeyService.registerAll();
      return true;
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  ipcMain.handle('config:reset', async (_event) => {
    try {
      await configService.resetToDefaults()
      ResidencyService.getInstance().apply(configService.getConfig().preferences?.autostart ?? false);
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  ipcMain.handle('config:export', async (_event) => {
    try {
      return await configService.exportConfig();
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  ipcMain.handle('config:get-path', () => {
    return configService.getConfigPath('config.json');
  });

  ipcMain.handle('config:import', async (event, configJson: string) => {
    try {
      return await configService.importConfig(configJson);
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  });

  ipcMain.handle('settings:open', async (_event, target?: SettingsOpenTarget) => {
    const safeTarget =
      target && typeof target === 'object'
        ? {
            tab: typeof target.tab === 'string' && target.tab.length <= 40 ? target.tab : undefined,
            section: typeof target.section === 'string' && target.section.length <= 40 ? target.section : undefined,
            commandId: typeof target.commandId === 'string' && target.commandId.length <= 200 ? target.commandId : undefined,
            miniAppsReportPackId:
              typeof target.miniAppsReportPackId === 'string' && target.miniAppsReportPackId.length <= 200 ? target.miniAppsReportPackId : undefined,
            miniAppsReportRunId:
              typeof target.miniAppsReportRunId === 'string' && target.miniAppsReportRunId.length <= 200 ? target.miniAppsReportRunId : undefined,
          }
        : undefined;
    windowManager.showSettingsWindow(safeTarget);
  });

  ipcMain.handle('settings:save', async (event, settings: Settings) => {
    try {
      await configService.saveSettings(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save settings via IPC:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
