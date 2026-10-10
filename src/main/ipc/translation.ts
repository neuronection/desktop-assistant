import { ipcMain } from 'electron';
import type {
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderView,
  TranslationRunResult,
} from '@shared/translation';
import type { TranslateService } from '@main/services/TranslateService';

/** Every channel this module registers (the teardown list consumes this). */
export const TRANSLATION_IPC_CHANNELS: string[] = [
  'translation:get-providers', 'translation:save-provider', 'translation:delete-provider',
  'translation:set-provider-enabled', 'translation:move-provider', 'translation:test-provider',
  'translation:translate',
];

export interface TranslationIpcDeps {
  translationService: TranslateService;
}

export function registerTranslationIpc(deps: TranslationIpcDeps): void {
  const { translationService } = deps;

  ipcMain.handle('translation:get-providers', async (): Promise<TranslationProviderView[]> => {
    return translationService.listProviders();
  });

  ipcMain.handle('translation:save-provider', async (_event, input: TranslationProviderSaveInput): Promise<TranslationProviderView> => {
    return translationService.saveProvider(input);
  });

  ipcMain.handle('translation:delete-provider', async (_event, providerId: string): Promise<boolean> => {
    return translationService.deleteProvider(providerId);
  });

  ipcMain.handle('translation:set-provider-enabled', async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return translationService.setProviderEnabled(providerId, enabled);
  });

  ipcMain.handle('translation:move-provider', async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return translationService.moveProvider(providerId, direction);
  });

  ipcMain.handle('translation:test-provider', async (_event, providerId: string): Promise<TranslationProviderTestResult> => {
    return translationService.testProvider(providerId);
  });

  ipcMain.handle('translation:translate', async (_event, request: unknown): Promise<TranslationRunResult> => {
    const input = (request ?? {}) as { text?: unknown; target?: unknown; source?: unknown };
    const text = typeof input.text === 'string' ? input.text : '';
    if (!text.trim() || text.length > 10_000) {
      throw new Error('Provide text to translate (max 10000 characters).');
    }
    const clean = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() && value.trim().length <= 32 ? value.trim().toLowerCase() : undefined;
    return translationService.translate({
      text,
      ...(clean(input.target) ? { target: clean(input.target) } : {}),
      ...(clean(input.source) ? { source: clean(input.source) } : {}),
    });
  });
}
