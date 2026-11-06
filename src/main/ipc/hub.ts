import { register } from './register';
import { IPC } from '@shared/ipc/registry';
import type { HubService } from '@main/hub/HubService';

export interface HubIpcDeps {
  service: HubService;
  open(): void;
  close(): void;
  openSettings(): void;
  copy(text: string): void;
  activateResult(): void;
  checkSelection(): void;
}

export function registerHubIpc(deps: HubIpcDeps): void {
  register(IPC['hub:open'], () => deps.open());
  register(IPC['hub:close'], () => deps.close());
  register(IPC['hub:get-actions'], async () => deps.service.actions());
  register(IPC['hub:run-quick'], (_event, id: string) => {
    void deps.service.run(id);
  });
  register(IPC['hub:run'], async (_event, id: string) => deps.service.run(id));
  register(IPC['hub:copy'], (_event, text: string) => deps.copy(text));
  register(IPC['hub:activate-result'], () => deps.activateResult());
  register(IPC['hub:check-selection'], () => deps.checkSelection());
  register(IPC['hub:open-settings'], () => deps.openSettings());
}
