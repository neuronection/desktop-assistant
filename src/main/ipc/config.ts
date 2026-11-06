import { BrowserWindow } from 'electron';
import type { AppConfig } from '@shared/config/AppConfig';
import type { Settings, SettingsOpenTarget } from '@shared/types';
import { ResidencyService } from '@main/services/ResidencyService';
import type { MainConfigService } from '@main/services/ConfigService';
import type { WindowManager } from '@main/window';
import type { HotkeyService } from '@main/services/HotkeyService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface ConfigIpcDeps {
  configService: MainConfigService;
  windowManager: WindowManager;
  hotkeyService: HotkeyService;
}

export function registerConfigIpc(deps: ConfigIpcDeps): void {
  const { configService, windowManager, hotkeyService } = deps;

  register(IPC['config:load'], async () => {
    try {
      return configService.getConfig();
    } catch (error) {
      console.error('Failed to load config via IPC:', error);
      return null;
    }
  });

  register(IPC['config:save'], async (event, config: Partial<AppConfig>) => {
    try {
      const previousTransparent = configService.getConfig().window?.transparent;
      const previousAutostart = configService.getConfig().preferences?.autostart ?? false;
      const previousVoice = configService.getConfig().voice;
      await configService.updateConfig(config);

      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('config-updated', config);
      });

      if (config.window && config.window.transparent !== previousTransparent) {
        void windowManager.recreateMainWindow();
      }

      if (config.voice) {
        const nextVoice = configService.getConfig().voice;
        const shapeKeys = [
          'speechHudStyle',
          'speechHudEdgeSide',
          'speechHudEdgeRatio',
          'speechHudDotXRatio',
          'speechHudDotYRatio',
          'speechHudCorner',
          'speechHudPosture',
          'hudSizePreset',
          'hudCustomSize',
          'hudPreset',
          'hudTextScale',
          'hubDockText',
          'hubDockWidth',
        ] as const;
        const shapeChanged = shapeKeys.some(
          (key) => JSON.stringify(previousVoice?.[key]) !== JSON.stringify(nextVoice?.[key])
        );
        const protectionChanged = previousVoice?.hudContentProtection !== nextVoice?.hudContentProtection;
        if (shapeChanged) {
          windowManager.applySpeechHudStyle();
        } else {
          if (protectionChanged) {
            windowManager.applyHudContentProtection();
          }
          windowManager.refreshSpeechHud();
        }
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

  register(IPC['config:reset'], async (_event) => {
    try {
      await configService.resetToDefaults()
      ResidencyService.getInstance().apply(configService.getConfig().preferences?.autostart ?? false);
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  register(IPC['config:export'], async (_event) => {
    try {
      return await configService.exportConfig();
    } catch (error) {
      console.error('Failed to save config via IPC:', error);
      throw error;
    }
  });

  register(IPC['config:import'], async (event, configJson: string) => {
    try {
      return await configService.importConfig(configJson);
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  });

  register(IPC['settings:open'], async (_event, target?: SettingsOpenTarget) => {
    windowManager.showSettingsWindow(target);
  });

  register(IPC['settings:save'], async (event, settings: Settings) => {
    try {
      await configService.saveSettings(settings);
      return { success: true };
    } catch (error) {
      console.error('Failed to save settings via IPC:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
