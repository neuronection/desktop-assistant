import type { ConnectorService } from '@main/services/cloud/ConnectorService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface CalendarIpcDeps {
  connectorService: ConnectorService;
}

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  const { connectorService } = deps;

  register(IPC['calendar:get-catalog'], async () => {
    return connectorService.catalogView();
  });

  register(IPC['calendar:accounts'], async () => {
    return connectorService.accounts();
  });

  register(IPC['calendar:bind-start'], async (_event, providerId: string, label?: string, accountId?: string) => {
    try {
      const boundAccountId = await connectorService.startBind(providerId, label, accountId);
      return { ok: true as const, accountId: boundAccountId };
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'provider-error';
      return { ok: false as const, code, error: error instanceof Error ? error.message : String(error) };
    }
  });

  register(IPC['calendar:bind-cancel'], async (_event, providerId: string) => {
    return connectorService.cancelBind(providerId);
  });

  register(IPC['calendar:bind-status'], async (_event, providerId: string) => {
    return connectorService.bindStatus(providerId);
  });

  register(IPC['calendar:unbind'], async (_event, accountId: string) => {
    return connectorService.unbind(accountId);
  });

  register(IPC['calendar:test'], async (_event, accountId: string) => {
    return connectorService.test(accountId);
  });
}
