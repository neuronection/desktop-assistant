import { BrowserWindow } from 'electron';
import type { AppConfig } from '@shared/config/AppConfig';
import { AiTask, type IPCResponse, type LLMProvider, type SetupProviderResult } from '@shared/types';
import { setDefaultModel, setupProviderFromPreset } from '@main/ai/providers/setup';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import type { MainConfigService } from '@main/services/ConfigService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface ProviderIpcDeps {
  configService: MainConfigService;
}

export function registerProviderIpc(deps: ProviderIpcDeps): void {
  const { configService } = deps;

  register(IPC['provider:add'], async (event, providerData: Omit<LLMProvider, 'id'>): Promise<IPCResponse<LLMProvider>> => {
    try {
      const newProvider = await configService.addLLMProvider(providerData);
      return { success: true, data: newProvider };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  register(IPC['provider:update'], async (event, provider: LLMProvider): Promise<IPCResponse<void>> => {
    try {
      await configService.updateLLMProvider(provider);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  register(IPC['provider:delete'], async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.deleteLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  register(IPC['provider:set-default'], async (event, providerId: string): Promise<IPCResponse<void>> => {
    try {
      await configService.setDefaultLLMProvider(providerId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  register(IPC['provider:setup-preset'], async (_event, presetKey: string, apiKey: string, name?: string, options?: { curatedIds?: string[]; bindChat?: boolean; bindVision?: boolean; bindStt?: boolean; bindEmbeddings?: boolean }): Promise<SetupProviderResult> => {
    try {
      const safeName = name?.trim() ? name.trim().slice(0, 80) : undefined;
      const safeOptions = options
        ? {
            ...(options.curatedIds ? { curatedIds: options.curatedIds.slice(0, 30) } : {}),
            ...(options.bindChat !== undefined ? { bindChat: options.bindChat } : {}),
            ...(options.bindVision !== undefined ? { bindVision: options.bindVision } : {}),
            ...(options.bindStt !== undefined ? { bindStt: options.bindStt } : {}),
            ...(options.bindEmbeddings !== undefined ? { bindEmbeddings: options.bindEmbeddings } : {}),
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
      const result = await setupProviderFromPreset(setupStore, presetKey, apiKey, safeName, safeOptions);
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

  register(IPC['provider:set-default-model'], async (_event, providerId: string, modelId: string, task?: string): Promise<IPCResponse<void>> => {
    try {
      const safeTask =
        task?.startsWith('decision:')
          ? task
          : task === AiTask.VISION
            ? AiTask.VISION
            : task === AiTask.STT
              ? AiTask.STT
              : task === AiTask.EMBED
                ? AiTask.EMBED
                : AiTask.CHAT;
      await setDefaultModel(configService, String(providerId), String(modelId), safeTask as AiTask);
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
