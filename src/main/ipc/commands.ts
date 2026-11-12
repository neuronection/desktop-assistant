import type { CommandService } from '@main/services/CommandService';
import type { AppDiscoveryService } from '@main/services/AppDiscoveryService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';
import { TEXT } from '@shared/constants/text';
import { systemCommandsAllowed } from '@main/services/system-verbs';

const SYSTEM_COMMAND_IDS = new Set(['system:lock', 'system:sleep', 'system:trash', 'system:theme']);

/** Every channel this module registers (the teardown list consumes this). */

export interface CommandsIpcDeps {
  commandService: CommandService;
  appDiscovery: AppDiscoveryService;
}

export function registerCommandsIpc(deps: CommandsIpcDeps): void {
  const { commandService, appDiscovery } = deps;

  register(IPC['commands:get-catalog'], async () => {
    await appDiscovery.ensureWarm();
    return commandService.snapshot();
  });

  register(IPC['commands:refresh-apps'], async () => {
    const apps = await appDiscovery.scan(true);
    return { count: apps.length };
  });

  register(IPC['commands:get-app-icon'], async (_event, appId: string) => {
    const app = appDiscovery.getApps().find((candidate) => candidate.id === appId);
    if (!app) {
      return null;
    }
    return appDiscovery.iconDataUrl(app);
  });

  register(IPC['commands:execute'], async (event, commandId: string, argv: string[], source?: 'palette' | 'hotkey') => {
    if (SYSTEM_COMMAND_IDS.has(commandId) && !systemCommandsAllowed(event.sender.getURL())) {
      return { status: 'error', error: TEXT.COMMAND_SYSTEM_UNAVAILABLE };
    }
    return commandService.execute(commandId, argv, source === 'hotkey' ? 'hotkey' : 'palette');
  });

  register(IPC['commands:clear-history'], async () => {
    await commandService.clearHistory();
    return true;
  });

  register(IPC['commands:save-custom'], async (_event, def: any) => {
    return commandService.saveCustom(def);
  });

  register(IPC['commands:delete-custom'], async (_event, id: string) => {
    return commandService.deleteCustom(id);
  });

  register(IPC['commands:import-integration'], async (_event, json: string, secrets: Record<string, string>) => {
    return commandService.importPack(json, secrets);
  });

  register(IPC['commands:remove-integration'], async (_event, packId: string) => {
    return commandService.removePack(packId);
  });
}
