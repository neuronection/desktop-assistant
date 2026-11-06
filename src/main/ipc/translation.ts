import type {
  TranslationProviderSaveInput,
  TranslationProviderTestResult,
  TranslationProviderView,
  TranslationRunResult,
} from '@shared/translation';
import type { TranslateService } from '@main/services/TranslateService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface TranslationIpcDeps {
  translationService: TranslateService;
}

export function registerTranslationIpc(deps: TranslationIpcDeps): void {
  const { translationService } = deps;

  register(IPC['translation:get-providers'], async (): Promise<TranslationProviderView[]> => {
    return translationService.listProviders();
  });

  register(IPC['translation:save-provider'], async (_event, input: TranslationProviderSaveInput): Promise<TranslationProviderView> => {
    return translationService.saveProvider(input);
  });

  register(IPC['translation:delete-provider'], async (_event, providerId: string): Promise<boolean> => {
    return translationService.deleteProvider(providerId);
  });

  register(IPC['translation:set-provider-enabled'], async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return translationService.setProviderEnabled(providerId, enabled);
  });

  register(IPC['translation:move-provider'], async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return translationService.moveProvider(providerId, direction);
  });

  register(IPC['translation:test-provider'], async (_event, providerId: string): Promise<TranslationProviderTestResult> => {
    return translationService.testProvider(providerId);
  });

  register(IPC['translation:translate'], async (_event, request: { text: string; target?: string; source?: string }): Promise<TranslationRunResult> => {
    const text = request.text.trim();
    if (!text) {
      throw new Error('Provide text to translate.');
    }
    const clean = (value: string | undefined): string | undefined =>
      value?.trim() && value.trim().length <= 32 ? value.trim().toLowerCase() : undefined;
    const target = clean(request.target);
    const source = clean(request.source);
    return translationService.translate({
      text,
      ...(target ? { target } : {}),
      ...(source ? { source } : {}),
    });
  });
}
