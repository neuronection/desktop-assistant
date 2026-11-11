import type { MainConfigService } from '@main/services/ConfigService';
import type { DatabaseService } from '@main/services/DatabaseService';
import { getUsageReport } from '@main/services/UsageService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface UsageIpcDeps {
  configService: MainConfigService;
  databaseService: DatabaseService;
}

export function registerUsageIpc({ configService, databaseService }: UsageIpcDeps): void {
  register(IPC['usage:report'], async () => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    return getUsageReport(client, configService.getConfig().usage?.pricing ?? []);
  });
}
