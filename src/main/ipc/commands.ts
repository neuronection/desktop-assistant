import { ipcMain } from 'electron';
import type { CommandService } from '@main/services/CommandService';
import type { AppDiscoveryService } from '@main/services/AppDiscoveryService';

/** Every channel this module registers (the teardown list consumes this). */
export const COMMANDS_IPC_CHANNELS: string[] = [
  'commands:get-catalog', 'commands:refresh-apps', 'commands:get-app-icon', 'commands:execute',
  'commands:clear-history', 'commands:save-custom', 'commands:delete-custom',
  'commands:import-integration', 'commands:remove-integration',
];

export interface CommandsIpcDeps {
  commandService: CommandService;
  appDiscovery: AppDiscoveryService;
}

export function registerCommandsIpc(deps: CommandsIpcDeps): void {
  const { commandService, appDiscovery } = deps;

  ipcMain.handle('commands:get-catalog', async () => {
    await appDiscovery.ensureWarm();
    return commandService.snapshot();
  });

  ipcMain.handle('commands:refresh-apps', async () => {
    const apps = await appDiscovery.scan(true);
    return { count: apps.length };
  });

  ipcMain.handle('commands:get-app-icon', async (_event, appId: string) => {
    if (typeof appId !== 'string' || appId.length === 0 || appId.length > 200) {
      return null;
    }
    const app = appDiscovery.getApps().find((candidate) => candidate.id === appId);
    if (!app) {
      return null;
    }
    return appDiscovery.iconDataUrl(app);
  });

  ipcMain.handle('commands:execute', async (_event, commandId: string, argv: unknown, source: unknown) => {
    if (typeof commandId !== 'string' || commandId.length === 0 || commandId.length > 200) {
      return { status: 'error', error: 'Invalid command id.' };
    }
    if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) {
      return { status: 'error', error: 'Invalid command arguments.' };
    }
    const invocationSource = source === 'hotkey' ? 'hotkey' : 'palette';
    return commandService.execute(commandId, argv as string[], invocationSource);
  });

  ipcMain.handle('commands:clear-history', async () => {
    await commandService.clearHistory();
    return true;
  });

  ipcMain.handle('commands:save-custom', async (_event, def) => {
    if (typeof def !== 'object' || def === null) {
      return { ok: false, error: 'Invalid command definition.' };
    }
    return commandService.saveCustom(def);
  });

  ipcMain.handle('commands:delete-custom', async (_event, id: string) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return false;
    }
    return commandService.deleteCustom(id);
  });

  ipcMain.handle('commands:import-integration', async (_event, json: string, secrets: Record<string, string>) => {
    if (typeof json !== 'string' || json.length === 0 || json.length > 200_000) {
      return { ok: false, error: 'Invalid manifest.' };
    }
    const safeSecrets: Record<string, string> = {};
    for (const [name, value] of Object.entries(typeof secrets === 'object' && secrets !== null ? secrets : {})) {
      if (typeof name === 'string' && name.length <= 100 && typeof value === 'string' && value.length <= 10_000) {
        safeSecrets[name] = value;
      }
    }
    return commandService.importPack(json, safeSecrets);
  });

  ipcMain.handle('commands:remove-integration', async (_event, packId: string) => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return false;
    }
    return commandService.removePack(packId);
  });
}
