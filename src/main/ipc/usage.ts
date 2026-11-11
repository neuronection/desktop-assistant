import type { MainConfigService } from '@main/services/ConfigService';
import type { DatabaseService } from '@main/services/DatabaseService';
import { getUsageReport } from '@main/services/UsageService';
import { isLocalApiBase } from '@shared/usage';

function localProviderIds(providers: { id: string; apiBase?: string }[]): Set<string> {
  return new Set(providers.filter((provider) => isLocalApiBase(provider.apiBase)).map((provider) => provider.id));
}
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface UsageIpcDeps {
  configService: MainConfigService;
  databaseService: DatabaseService;
}

export function registerUsageIpc({ configService, databaseService }: UsageIpcDeps): void {
  register(IPC['usage:report'], async () => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    const config = configService.getConfig();
    return getUsageReport(
      client,
      config.usage?.pricing ?? [],
      localProviderIds(config.providers)
    );
  });
}
