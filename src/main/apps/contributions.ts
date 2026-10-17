import { interpolate, TEXT } from '@shared/constants/text';
import type { MiniAppRegistry } from './registry';
import type { SandboxService } from './sandbox/SandboxService';
import { formatPackError } from './errors';

export interface ContributionBridgeDeps {
  registry: MiniAppRegistry;
  sandbox: SandboxService;
}

/**
 * The Tier-2 contribution dispatch (ADR-0030 clause 3): a declared
 * command id becomes ONE sandboxed invoke (`command:<id>`). Logic runs
 * in the sandbox, the result crosses as data — the renderer never
 * imports pack code, and only commands the installed manifest declares
 * can be addressed.
 */
export function createContributionBridge({ registry, sandbox }: ContributionBridgeDeps): {
  executePackCommand(packId: string, commandId: string, args: string[]): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
} {
  return {
    async executePackCommand(packId, commandId, args) {
      const view = registry.getState().packs.find((candidate) => candidate.id === packId);
      if (!view || !view.sandboxed || !view.enabled) {
        return { ok: false, error: 'Unknown sandboxed pack.' };
      }
      const manifest = registry.runnablePack(packId)?.manifest as { contributions?: { commands?: { id: string }[] } } | undefined;
      if (!manifest?.contributions?.commands?.some((command) => command.id === commandId)) {
        return {
          ok: false,
          error: interpolate(TEXT.MINIAPPS_COMMAND_FAILED, { title: packId, error: `undeclared command '${commandId}'` }),
        };
      }
      const outcome = await sandbox.invoke(packId, commandId, { argv: args });
      const title = view.title;
      if (!outcome.ok) {
        const detail = outcome.fatal ? outcome.reason : formatPackError(outcome.error);
        return { ok: false, error: interpolate(TEXT.MINIAPPS_COMMAND_FAILED, { title, error: detail }) };
      }
      return {
        ok: true,
        text: interpolate(TEXT.MINIAPPS_COMMAND_RESULT, { title, result: JSON.stringify(outcome.result.output) }),
      };
    },
  };
}
