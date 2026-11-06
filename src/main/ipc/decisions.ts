import type { DecisionSettingsController } from '@main/ai/decide/settings-controller';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface DecisionsIpcDeps {
  decisionSettings: DecisionSettingsController;
}

export function registerDecisionsIpc(deps: DecisionsIpcDeps): void {
  const { decisionSettings } = deps;

  register(IPC['decisions:get-state'], async () => {
    return decisionSettings.getState();
  });

  register(IPC['decisions:test'], async (_event, input: string) => {
    const text = input.trim().slice(0, 200);
    if (!text) {
      throw new Error('Provide a command to test.');
    }
    return decisionSettings.test(text);
  });
}
