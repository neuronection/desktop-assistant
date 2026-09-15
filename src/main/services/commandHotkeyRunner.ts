import type { CommandHotkeyBinding } from '@shared/config/AppConfig';
import type { CommandService } from '@main/services/CommandService';

export interface CommandHotkeyRunnerDeps {
  commandService: Pick<CommandService, 'execute'>;
  commandTitle(commandId: string): string | null;
  binding(commandId: string): CommandHotkeyBinding | undefined;
  /** Persists the dedicated conversation back into the binding. */
  saveConversationId(commandId: string, conversationId: string): Promise<void>;
  createConversation(title: string): Promise<{ id: string }>;
  startTurn(request: { conversationId: string; content: string; directTool?: { name: string; args: Record<string, unknown> } }): Promise<string>;
  isBusy(): boolean;
  wait(ms: number): Promise<void>;
  notify(title: string, body: string): void;
  now?(): number;
}

const BUSY_POLL_MS = 2_000;
const BUSY_POLLS = 150;

/**
 * Executes a custom command from a global hotkey (plan 12 §4 macro
 * half): same `CommandService.execute` path as the palette, but the
 * renderer is not involved — 'turn' outcomes start a real turn through
 * the TurnManager in a dedicated per-command conversation (created once
 * and reused). 'done'/'error' outcomes surface as notifications.
 */
export function createCommandHotkeyRunner(deps: CommandHotkeyRunnerDeps): (commandId: string) => Promise<void> {
  return async (commandId: string): Promise<void> => {
    try {
      const outcome = await deps.commandService.execute(commandId, [], 'hotkey');
      if (outcome.status === 'done') {
        deps.notify(outcome.text || 'Command executed', outcome.text || '');
        return;
      }
      if (outcome.status === 'error') {
        deps.notify('Command failed', outcome.error);
        return;
      }
      if (outcome.status !== 'turn' || (!outcome.prompt && !outcome.direct)) {
        deps.notify('Command not hotkey-assignable', `'${deps.commandTitle(commandId) ?? commandId}' needs a prompt or a bound tool.`);
        return;
      }
      for (let attempt = 0; attempt < BUSY_POLLS && deps.isBusy(); attempt += 1) {
        await deps.wait(BUSY_POLL_MS);
      }
      const binding = deps.binding(commandId);
      let conversationId = binding?.conversationId;
      if (!conversationId) {
        conversationId = (await deps.createConversation(`Command — ${deps.commandTitle(commandId) ?? commandId}`)).id;
        await deps.saveConversationId(commandId, conversationId);
      }
      if (outcome.prompt) {
        await deps.startTurn({ conversationId, content: outcome.prompt });
      } else if (outcome.direct) {
        await deps.startTurn({
          conversationId,
          content: deps.commandTitle(commandId) ?? commandId,
          directTool: outcome.direct,
        });
      }
    } catch (error) {
      console.error(`Command hotkey for '${commandId}' failed:`, error);
      deps.notify('Command failed', (error as Error).message ?? String(error));
    }
  };
}
