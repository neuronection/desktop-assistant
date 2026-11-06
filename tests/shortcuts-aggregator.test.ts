import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HotkeyAction, type HotkeyConfig } from '@shared/types';
import { SHORTCUT_GROUPS } from '@shared/shortcuts';
import { IPC_REGISTRY } from '@shared/ipc/registry';

const register = vi.fn(() => true);

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => register(accelerator, callback),
    unregisterAll: vi.fn(),
  },
  app: { isPackaged: false, getPath: () => '/tmp' },
}));

let config: {
  hotkeys: Record<string, HotkeyConfig>;
  commands?: { commandHotkeys?: Record<string, { accelerator: string }> };
};

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: {
    getInstance: () => ({
      getConfig: () => config,
      updateConfig: async (next: typeof config) => {
        config = next;
      },
    }),
  },
}));

vi.mock('@main/window', () => ({ WindowManager: class {} }));

import { DEFAULT_HOTKEYS, HotkeyService } from '@main/services/HotkeyService';

function service(): HotkeyService {
  (HotkeyService as unknown as { instance?: unknown }).instance = undefined;
  return HotkeyService.getInstance(
    {
      getConfig: () => config,
      updateConfig: async (next: typeof config) => {
        config = next;
      },
    } as never,
    {} as never
  );
}

beforeEach(() => {
  register.mockClear();
  config = { hotkeys: {}, commands: { commandHotkeys: {} } };
});

describe('HotkeyService.getShortcuts (plan 59 D2)', () => {
  it('lists every built-in action with its live accelerator and label', () => {
    const hotkeys = service();
    const view = hotkeys.getShortcuts();
    expect(view.builtIns).toHaveLength(Object.keys(DEFAULT_HOTKEYS).length);
    const selection = view.builtIns.find((entry) => entry.action === HotkeyAction.SpeakSelection);
    expect(selection).toEqual({
      action: HotkeyAction.SpeakSelection,
      label: DEFAULT_HOTKEYS[HotkeyAction.SpeakSelection].label,
      accelerator: 'CommandOrControl+Shift+S',
    });
    const launcher = view.builtIns.find((entry) => entry.action === HotkeyAction.ToggleWindow);
    expect(launcher?.accelerator).toBe('Control+Space');
  });

  it('keeps an unbound action visible with a null accelerator', () => {
    const pause = service()
      .getShortcuts()
      .builtIns.find((entry) => entry.action === HotkeyAction.PauseSpeaking);
    expect(pause).toBeDefined();
    expect(pause?.accelerator).toBeNull();
  });

  it('resolves bound command hotkeys and drops dangling bindings', () => {
    config.commands = {
      commandHotkeys: {
        'cmd-summarize': { accelerator: 'Control+Alt+S' },
        'cmd-deleted': { accelerator: 'Control+Alt+U' },
      },
    };
    const hotkeys = service();
    hotkeys.setCommandLabelResolver((id) => (id === 'cmd-summarize' ? 'Summarize page' : null));
    expect(hotkeys.getShortcuts().commands).toEqual([
      { action: 'cmd-summarize', label: 'Summarize page', accelerator: 'Control+Alt+S' },
    ]);
  });

  it('takes built-in labels from the shipped defaults, never the persisted copy', () => {
    config.hotkeys = {
      [HotkeyAction.ToggleWindow]: {
        action: HotkeyAction.ToggleWindow,
        accelerator: 'Alt+J',
        label: 'Renamed long ago',
        isEditable: true,
      },
    };
    const view = service().getShortcuts();
    expect(view.builtIns.find((entry) => entry.action === HotkeyAction.ToggleWindow)).toEqual({
      action: HotkeyAction.ToggleWindow,
      label: DEFAULT_HOTKEYS[HotkeyAction.ToggleWindow].label,
      accelerator: 'Alt+J',
    });
  });

  it('omits the commands group when no command hotkey is bound', () => {
    config.commands = { commandHotkeys: { 'cmd-idle': { accelerator: '' } } };
    expect(service().getShortcuts().commands).toEqual([]);
  });

  it('reads live state: an edited accelerator appears on the next call', async () => {
    const hotkeys = service();
    await hotkeys.saveAndReloadHotkeys({
      [HotkeyAction.ToggleWindow]: { action: HotkeyAction.ToggleWindow, accelerator: 'Alt+J', label: '', isEditable: true },
    });
    expect(
      hotkeys.getShortcuts().builtIns.find((entry) => entry.action === HotkeyAction.ToggleWindow)?.accelerator
    ).toBe('Alt+J');
  });

  it('stops registering a chord whose binding was cleaned up', () => {
    config.commands = { commandHotkeys: { 'cmd-dead': { accelerator: 'Control+Alt+D' } } };
    service().registerAll();
    expect(register.mock.calls.filter(([accelerator]) => accelerator === 'Control+Alt+D')).toHaveLength(1);

    config.commands = { commandHotkeys: {} };
    service().registerAll();
    expect(register.mock.calls.filter(([accelerator]) => accelerator === 'Control+Alt+D')).toHaveLength(1);
  });

  it('every action maps to a sheet section (exhaustive)', () => {
    for (const action of Object.values(HotkeyAction)) {
      expect(['general', 'voice'], String(action)).toContain(SHORTCUT_GROUPS[action]);
    }
  });
});

describe('hotkeys:shortcuts channel', () => {
  it('is launcher-scoped, invoke-only and bridged', () => {
    const descriptor = IPC_REGISTRY.find((entry) => entry.channel === 'hotkeys:shortcuts');
    expect(descriptor).toMatchObject({
      direction: 'invoke',
      scope: ['launcher'],
      group: 'hotkeys',
    });
    expect(descriptor?.bridge).toEqual({ method: 'getShortcuts', kind: 'invoke' });
  });
});
