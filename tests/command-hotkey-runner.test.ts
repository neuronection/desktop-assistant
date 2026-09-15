import { describe, it, expect, vi } from 'vitest';
import { createCommandHotkeyRunner, type CommandHotkeyRunnerDeps } from '@main/services/commandHotkeyRunner';

function harness(overrides: Partial<CommandHotkeyRunnerDeps> = {}): {
  runner: (commandId: string) => Promise<void>;
  deps: CommandHotkeyRunnerDeps & {
    started: { conversationId: string; content: string; directTool?: { name: string; args: Record<string, unknown> } }[];
    notifications: { title: string; body: string }[];
  };
} {
  const started: { conversationId: string; content: string; directTool?: { name: string; args: Record<string, unknown> } }[] = [];
  const notifications: { title: string; body: string }[] = [];
  let busy = false;
  const deps: CommandHotkeyRunnerDeps & {
    started: typeof started;
    notifications: typeof notifications;
  } = {
    commandService: {
      execute: vi.fn(async () => ({ status: 'done', text: 'ok' })),
    },
    commandTitle: (commandId) => (commandId === 'custom:1' ? 'Deploy check' : null),
    binding: () => undefined,
    saveConversationId: vi.fn(async () => undefined),
    createConversation: vi.fn(async (title) => ({ id: `conv_${title}` })),
    startTurn: vi.fn(async (request) => {
      started.push(request);
      return 'turn_1';
    }),
    isBusy: () => busy,
    wait: vi.fn(async () => undefined),
    notify: (title, body) => notifications.push({ title, body }),
    started,
    notifications,
    ...overrides,
  };
  return { runner: createCommandHotkeyRunner(deps), deps };
}

describe('command hotkey runner', () => {
  it('starts a prompt turn in a dedicated conversation and persists it', async () => {
    const { runner, deps } = harness({
      commandService: { execute: vi.fn(async () => ({ status: 'turn', prompt: 'Check deploys' })) },
    });
    await runner('custom:1');
    expect(deps.createConversation).toHaveBeenCalledWith('Command — Deploy check');
    expect(deps.saveConversationId).toHaveBeenCalledWith('custom:1', 'conv_Command — Deploy check');
    expect(deps.started).toEqual([{ conversationId: 'conv_Command — Deploy check', content: 'Check deploys' }]);
  });

  it('reuses the persisted conversation and starts direct tool turns', async () => {
    const { runner, deps } = harness({
      commandService: {
        execute: vi.fn(async () => ({ status: 'turn', direct: { name: 'screen_capture', args: { mode: 'full' } } })),
      },
      binding: () => ({ accelerator: 'Control+Shift+1', conversationId: 'conv_existing' }),
    });
    await runner('custom:1');
    expect(deps.createConversation).not.toHaveBeenCalled();
    expect(deps.saveConversationId).not.toHaveBeenCalled();
    expect(deps.started).toEqual([
      { conversationId: 'conv_existing', content: 'Deploy check', directTool: { name: 'screen_capture', args: { mode: 'full' } } },
    ]);
  });

  it('waits while a turn is active before starting', async () => {
    let busy = true;
    const { runner, deps } = harness({
      commandService: { execute: vi.fn(async () => ({ status: 'turn', prompt: 'Hello' })) },
      isBusy: () => busy,
      binding: () => ({ accelerator: 'Control+Shift+1', conversationId: 'conv_existing' }),
    });
    const done = runner('custom:1');
    await Promise.resolve();
    expect(deps.started).toHaveLength(0);
    busy = false;
    await done;
    expect(deps.started).toHaveLength(1);
  });

  it('notifies done and error outcomes without starting a turn', async () => {
    const done = harness({ commandService: { execute: vi.fn(async () => ({ status: 'done', text: 'Launched' })) } });
    await done.runner('custom:1');
    expect(done.deps.notifications).toContainEqual({ title: 'Launched', body: 'Launched' });
    expect(done.deps.started).toHaveLength(0);

    const failed = harness({ commandService: { execute: vi.fn(async () => ({ status: 'error', error: 'nope' })) } });
    await failed.runner('custom:1');
    expect(failed.deps.notifications).toContainEqual({ title: 'Command failed', body: 'nope' });
    expect(failed.deps.started).toHaveLength(0);
  });

  it('rejects commands that defer to the renderer with a clear notice', async () => {
    const { runner, deps } = harness({
      commandService: { execute: vi.fn(async () => ({ status: 'turn' })) },
    });
    await runner('native:tool');
    expect(deps.notifications[0].title).toBe('Command not hotkey-assignable');
    expect(deps.started).toHaveLength(0);
  });
});
