import { ipcMain } from 'electron';
import type { DecisionSettingsController } from '@main/ai/decide/settings-controller';

/** Every channel this module registers (the teardown list consumes this). */
export const DECISIONS_IPC_CHANNELS: string[] = ['decisions:get-state', 'decisions:test'];

export interface DecisionsIpcDeps {
  decisionSettings: DecisionSettingsController;
}

export function registerDecisionsIpc(deps: DecisionsIpcDeps): void {
  const { decisionSettings } = deps;

  ipcMain.handle('decisions:get-state', async () => {
    return decisionSettings.getState();
  });

  ipcMain.handle('decisions:test', async (_event, input: unknown) => {
    const text = typeof input === 'string' ? input.trim().slice(0, 200) : '';
    if (!text) {
      throw new Error('Provide a command to test.');
    }
    return decisionSettings.test(text);
  });
}
