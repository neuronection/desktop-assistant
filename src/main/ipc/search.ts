import { ipcMain } from 'electron';
import type { SearchProviderSaveInput, SearchProviderTestResult, SearchProviderView } from '@shared/search';
import type { SearchService } from '@main/services/SearchService';

/** Every channel this module registers (the teardown list consumes this). */
export const SEARCH_IPC_CHANNELS: string[] = [
  'search:get-providers', 'search:save-provider', 'search:delete-provider',
  'search:set-provider-enabled', 'search:move-provider', 'search:test-provider',
];

export interface SearchIpcDeps {
  searchService: SearchService;
}

export function registerSearchIpc(deps: SearchIpcDeps): void {
  const { searchService } = deps;

  ipcMain.handle('search:get-providers', async (): Promise<SearchProviderView[]> => {
    return searchService.listProviders();
  });

  ipcMain.handle('search:save-provider', async (_event, input: SearchProviderSaveInput): Promise<SearchProviderView> => {
    return searchService.saveProvider(input);
  });

  ipcMain.handle('search:delete-provider', async (_event, providerId: string): Promise<boolean> => {
    return searchService.deleteProvider(providerId);
  });

  ipcMain.handle('search:set-provider-enabled', async (_event, providerId: string, enabled: boolean): Promise<boolean> => {
    return searchService.setProviderEnabled(providerId, enabled);
  });

  ipcMain.handle('search:move-provider', async (_event, providerId: string, direction: 'up' | 'down'): Promise<boolean> => {
    return searchService.moveProvider(providerId, direction);
  });

  ipcMain.handle('search:test-provider', async (_event, providerId: string): Promise<SearchProviderTestResult> => {
    return searchService.testProvider(providerId);
  });
}
