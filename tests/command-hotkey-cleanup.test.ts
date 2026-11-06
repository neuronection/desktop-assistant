import { describe, it, expect, vi } from 'vitest';
import { deleteCustomCommand, removeIntegrationPack } from '@main/services/commands/parser';
import type { CommandsSettings } from '@shared/config/AppConfig';

function commands(overrides: Partial<CommandsSettings> = {}): CommandsSettings {
  return {
    enabled: true,
    custom: [],
    hidden: [],
    pins: [],
    extraAliases: {},
    argDefaults: {},
    commandHotkeys: {},
    apps: { discovery: true, launchEnabled: true, hiddenApps: [] },
    web: { behavior: 'inline', fallbackEngine: '' },
    history: { enabled: true, retentionDays: 30 },
    integrations: [],
    agentCallable: {},
    ...overrides,
  } as CommandsSettings;
}

function deps(config: CommandsSettings) {
  const patches: Partial<CommandsSettings>[] = [];
  return {
    patches,
    deps: {
      config: () => config,
      updateCommands: async (patch: Partial<CommandsSettings>) => {
        patches.push(patch);
      },
      deleteSecret: vi.fn(async () => undefined),
    } as never,
  };
}

describe('dangling command hotkeys die with their command (plan 59 D9)', () => {
  it('deleting a custom command removes its binding and keeps the others', async () => {
    const { patches, deps: service } = deps(
      commands({
        custom: [{ id: 'custom-a', name: 'A', aliases: [], kind: 'prompt', promptTemplate: 'x' } as never],
        commandHotkeys: {
          'custom-a': { accelerator: 'Control+Alt+A' },
          'custom-b': { accelerator: 'Control+Alt+B' },
        },
      })
    );
    expect(await deleteCustomCommand(service, 'custom-a')).toBe(true);
    expect(patches[0].custom).toEqual([]);
    expect(patches[0].commandHotkeys).toEqual({ 'custom-b': { accelerator: 'Control+Alt+B' } });
  });

  it('removing an integration pack removes every command binding', async () => {
    const { patches, deps: service } = deps(
      commands({
        integrations: [
          {
            id: 'pack-1',
            name: 'Pack',
            enabled: true,
            commands: [
              { id: 'pack-cmd-1', kind: 'http', title: 'One', headers: {} } as never,
              { id: 'pack-cmd-2', kind: 'http', title: 'Two', headers: {} } as never,
            ],
          },
        ],
        commandHotkeys: {
          'pack-cmd-1': { accelerator: 'Control+Alt+1' },
          'pack-cmd-2': { accelerator: 'Control+Alt+2' },
          'custom-b': { accelerator: 'Control+Alt+B' },
        },
      })
    );
    expect(await removeIntegrationPack(service, 'pack-1')).toBe(true);
    expect(patches[0].integrations).toEqual([]);
    expect(patches[0].commandHotkeys).toEqual({ 'custom-b': { accelerator: 'Control+Alt+B' } });
  });

  it('leaves the hotkey map untouched when the command had no binding', async () => {
    const { patches, deps: service } = deps(
      commands({
        custom: [{ id: 'custom-a', name: 'A', aliases: [], kind: 'prompt', promptTemplate: 'x' } as never],
        commandHotkeys: { 'custom-b': { accelerator: 'Control+Alt+B' } },
      })
    );
    expect(await deleteCustomCommand(service, 'custom-a')).toBe(true);
    expect(patches[0].commandHotkeys).toBeUndefined();
  });
});
