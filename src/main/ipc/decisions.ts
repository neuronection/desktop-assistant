import { ipcMain } from 'electron';
import { SecretService, openrouterSecretKey } from '@main/services/SecretService';
import type { DecisionSettingsController } from '@main/ai/decide/settings-controller';

/** Every channel this module registers (the teardown list consumes this). */
export const DECISIONS_IPC_CHANNELS: string[] = [
  'decisions:get-state', 'decisions:download-weights', 'decisions:cancel-download',
  'decisions:test', 'decisions:set-key', 'decisions:clear-key',
];

export interface DecisionsIpcDeps {
  decisionSettings: DecisionSettingsController;
}

export function registerDecisionsIpc(deps: DecisionsIpcDeps): void {
  const { decisionSettings } = deps;

  ipcMain.handle('decisions:get-state', async () => {
    return decisionSettings.getState();
  });

  ipcMain.handle('decisions:download-weights', async () => {
    return decisionSettings.downloadWeights();
  });

  ipcMain.handle('decisions:cancel-download', async () => {
    return decisionSettings.cancelDownload();
  });

  ipcMain.handle('decisions:test', async (_event, input: unknown) => {
    const text = typeof input === 'string' ? input.trim().slice(0, 200) : '';
    if (!text) {
      throw new Error('Provide a command to test.');
    }
    return decisionSettings.test(text);
  });

  ipcMain.handle('decisions:set-key', async (_event, key: unknown) => {
    const value = typeof key === 'string' ? key.trim() : '';
    if (!value) {
      return false;
    }
    await SecretService.getInstance().setSecret(openrouterSecretKey(), value);
    return true;
  });

  ipcMain.handle('decisions:clear-key', async () => {
    await SecretService.getInstance().deleteSecret(openrouterSecretKey());
    return true;
  });
}
