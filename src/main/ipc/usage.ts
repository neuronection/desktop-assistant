import type { MainConfigService } from '@main/services/ConfigService';
import type { DatabaseService } from '@main/services/DatabaseService';
import { getTurnReceipt, getUsageReport } from '@main/services/UsageService';
import { getEgressLog } from '@main/security/egress';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface UsageIpcDeps {
  configService: MainConfigService;
  databaseService: DatabaseService;
}

export function registerUsageIpc({ databaseService }: UsageIpcDeps): void {
  register(IPC['usage:turn'], async (_event, messageId: string) => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    const destinations = getEgressLog().filter((entry) => entry.turnId === messageId);
    return getTurnReceipt(client, messageId, destinations);
  });

  register(IPC['usage:report'], async () => {
    const client = databaseService.isReady() ? databaseService.getClient() : null;
    return getUsageReport(client);
  });
}
