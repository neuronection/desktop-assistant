import { ipcMain, BrowserWindow } from 'electron';
import type { AppConfig } from '@shared/config/AppConfig';
import { AiTask, type IPCResponse, type LLMProvider, type SetupProviderResult } from '@shared/types';
import { setDefaultModel, setupProviderFromPreset } from '@main/ai/providers/setup';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import type { MainConfigService } from '@main/services/ConfigService';

/** Every channel this module registers (the teardown list consumes this). */
export const PROVIDER_IPC_CHANNELS: string[] = [
  'provider:add', 'provider:update', 'provider:delete', 'provider:set-default',
  'provider:setup-preset', 'provider:set-default-model',
];

export interface ProviderIpcDeps {
  configService: MainConfigService;
}

export function registerProviderIpc(deps: ProviderIpcDeps): void {
  const { configService } = deps;

  ipcMain.handle('provider:add', async (event, providerData: Omit<LLMProvider, 'id'>): Promise<IPCResponse<LLMProvider>> => {
    try {
      const newProvider = await configService.addLLMProvider(providerData);
      return { success: true, data: newProvider };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:update', async (event, provider: LLMProvider): Promise<IPCResponse<void>> => {
    try {
      await configService.updateLLMProvider(provider);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:delete', async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.deleteLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:set-default', async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.setDefaultLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('provider:setup-preset', async (_event, presetKey: string, apiKey: string, name?: string, options?: { curatedIds?: string[]; bindChat?: boolean; bindVision?: boolean; bindStt?: boolean }): Promise<SetupProviderResult> => {
    try {
      const key = typeof apiKey === 'string' ? apiKey : '';
      const safeName = typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80 ? name.trim() : undefined;
      const safeOptions =
        options && typeof options === 'object'
          ? {
              ...(Array.isArray(options.curatedIds)
                ? { curatedIds: options.curatedIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 100).slice(0, 30) }
                : {}),
              ...(typeof options.bindChat === 'boolean' ? { bindChat: options.bindChat } : {}),
              ...(typeof options.bindVision === 'boolean' ? { bindVision: options.bindVision } : {}),
              ...(typeof options.bindStt === 'boolean' ? { bindStt: options.bindStt } : {}),
            }
          : undefined;
      const setupStore = {
        getConfig: () => configService.getConfig(),
        addLLMProvider: (provider: Omit<LLMProvider, 'id'>) => configService.addLLMProvider(provider),
        updateLLMProvider: (provider: LLMProvider) => configService.updateLLMProvider(provider),
        setDefaultLLMProvider: (id: string) => configService.setDefaultLLMProvider(id),
        updateConfig: (updates: Partial<AppConfig>) => configService.updateConfig(updates),
        resolveSecret: async (id: string) =>
          (await SecretService.getInstance().getSecret(providerSecretKey(id))) ?? null,
      };
      const result = await setupProviderFromPreset(setupStore, String(presetKey), key, safeName, safeOptions);
      if (result.ok) {
        const config = configService.getConfig();
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send('config-updated', config);
        });
      }
      return result;
    } catch (error: any) {
      console.error('Provider preset setup failed:', error);
      return { ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown', vendorMessage: error.message };
    }
  });

  ipcMain.handle('provider:set-default-model', async (_event, providerId: string, modelId: string, task?: string): Promise<IPCResponse<void>> => {
    try {
      const safeTask = task === AiTask.VISION ? AiTask.VISION : task === AiTask.STT ? AiTask.STT : AiTask.CHAT;
      await setDefaultModel(configService, String(providerId), String(modelId), safeTask);
      const config = configService.getConfig();
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('config-updated', config);
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
