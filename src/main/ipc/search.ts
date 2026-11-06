import type { SearchProviderSaveInput, SearchProviderTestResult, SearchProviderView } from '@shared/search';
import type { SearchService } from '@main/services/SearchService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface SearchIpcDeps {
  searchService: SearchService;
}

export function registerSearchIpc(deps: SearchIpcDeps): void {
  const { searchService } = deps;

  register(IPC['search:get-providers'], async (): Promise<SearchProviderView[]> => {
    return searchService.listProviders();
  });

  register(IPC['search:save-provider'], async (_event, input: SearchProviderSaveInput): Promise<SearchProviderView> => {
    return searchService.saveProvider(input);
  });

  register(IPC['search:delete-provider'], async (_event, providerId: string): Promise<boolean> => {
    return searchService.deleteProvider(providerId);
  });

  register(IPC['search:set-provider-enabled'], async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return searchService.setProviderEnabled(providerId, enabled);
  });

  register(IPC['search:move-provider'], async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return searchService.moveProvider(providerId, direction);
  });

  register(IPC['search:test-provider'], async (_event, providerId: string): Promise<SearchProviderTestResult> => {
    return searchService.testProvider(providerId);
  });
}
