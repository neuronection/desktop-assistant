import { shell } from 'electron';
import { IPC } from '@shared/ipc/registry';
import type { UpdateService } from '@main/services/updates';
import { register } from './register';

export interface UpdatesIpcDeps {
  updateService: UpdateService;
}

export function registerUpdatesIpc(deps: UpdatesIpcDeps): void {
  const { updateService } = deps;
  register(IPC['updates:status'], async () => updateService.getState());
  register(IPC['updates:check'], async () => updateService.checkNow());
  register(IPC['updates:apply'], async () => updateService.apply());
  register(IPC['updates:install'], async () => {
    updateService.install();
    return { ok: true };
  });
  register(IPC['updates:open-release'], async () => {
    const release = updateService.getState().release;
    if (!release) return { success: false };
    await shell.openExternal(release.url);
    return { success: true };
  });
}
