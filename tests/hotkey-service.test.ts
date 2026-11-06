import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HotkeyAction } from '@shared/types';

let dataDir: string;

vi.mock('electron', () => {
  const registered = new Map<string, () => void>();
  return {
    app: { getPath: (_name: string) => dataDir, getAppPath: () => process.cwd() },
    globalShortcut: {
      register: vi.fn((accelerator: string, handler: () => void) => {
        registered.set(accelerator, handler);
      }),
      unregisterAll: vi.fn(() => registered.clear()),
      isRegistered: (accelerator: string) => registered.has(accelerator),
      __registered: registered,
    },
  };
});

const freshService = async () => {
  const configMod = await import('@main/services/ConfigService');
  (configMod.MainConfigService as { instance?: unknown }).instance = undefined;
  const configService = configMod.MainConfigService.getInstance();
  await configService.loadConfig();
  const windowManager = {
    toggleMainWindow: vi.fn(),
    showSettingsWindow: vi.fn(),
    showMainWindow: vi.fn(),
    showDesktopWindow: vi.fn(),
    getMainWindow: vi.fn(() => ({ webContents: { send: vi.fn() } })),
  };
  const { HotkeyService } = await import('@main/services/HotkeyService');
  (HotkeyService as { instance?: unknown }).instance = undefined;
  const service = HotkeyService.getInstance(configService, windowManager);
  return { service, configService, windowManager, shortcuts: (await import('electron')).globalShortcut.__registered as Map<string, () => void> };
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  dataDir = mkdtempSync(join(tmpdir(), 'da-hotkey-service-'));
});

describe('HotkeyService (plan 46 S2)', () => {
  it('registerAll registers every default accelerator after clearing the previous set', async () => {
    const { service, shortcuts } = await freshService();
    service.registerAll();
    expect(shortcuts.has('Control+Space')).toBe(true);
    expect(shortcuts.has('CommandOrControl+,')).toBe(true);
    expect(shortcuts.has('CommandOrControl+Shift+Space')).toBe(true);
    expect(shortcuts.has('CommandOrControl+Alt+Space')).toBe(true);
  });

  it('fires the action handler for the bound accelerator', async () => {
    const { service, windowManager, shortcuts } = await freshService();
    service.registerAll();
    shortcuts.get('Control+Space')!();
    expect(windowManager.toggleMainWindow).toHaveBeenCalledTimes(1);
    shortcuts.get('CommandOrControl+,')!();
    expect(windowManager.showSettingsWindow).toHaveBeenCalledTimes(1);
  });

  it('routes command hotkeys to the command runner, skipping colliding accelerators', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { service, configService, shortcuts } = await freshService();
    const runner = vi.fn();
    service.setCommandRunner(runner);
    await configService.updateConfigSection('commands', {
      ...(configService.getConfig().commands ?? {}),
      commandHotkeys: {
        'custom-clean': { accelerator: 'Control+Space' },
        'custom-free': { accelerator: 'Control+Alt+F9' },
      },
    });
    service.registerAll();
    shortcuts.get('Control+Alt+F9')!();
    expect(runner).toHaveBeenCalledWith('custom-free');
    expect(runner).not.toHaveBeenCalledWith('custom-clean');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already in use'));
    warn.mockRestore();
  });

  it('saveAndReloadHotkeys re-registers from the persisted config (the config-save seam)', async () => {
    const { service, shortcuts } = await freshService();
    service.registerAll();
    expect(shortcuts.has('Control+Space')).toBe(true);

    await service.saveAndReloadHotkeys({
      [HotkeyAction.ToggleWindow]: { action: HotkeyAction.ToggleWindow, accelerator: 'Control+Shift+Y', label: 'Toggle App Window', isEditable: true },
    });
    expect(shortcuts.has('Control+Space')).toBe(false);
    expect(shortcuts.has('Control+Shift+Y')).toBe(true);
    expect(service.getSettings()[HotkeyAction.ToggleWindow].accelerator).toBe('Control+Shift+Y');
  });

  it('saveAndReloadHotkeys ignores non-editable actions (the guard reads stored config)', async () => {
    const configMod = await import('@main/services/ConfigService');
    (configMod.MainConfigService as { instance?: unknown }).instance = undefined;
    const configService = configMod.MainConfigService.getInstance();
    await configService.loadConfig();
    await configService.updateConfigSection('hotkeys', {
      ...configService.getConfig().hotkeys,
      [HotkeyAction.ToggleWindow]: { action: HotkeyAction.ToggleWindow, accelerator: 'Control+Space', label: 'Toggle App Window', isEditable: false },
    });
    const windowManager = {
      toggleMainWindow: vi.fn(),
      showSettingsWindow: vi.fn(),
      showMainWindow: vi.fn(),
      showDesktopWindow: vi.fn(),
      getMainWindow: vi.fn(() => null),
    };
    const { HotkeyService } = await import('@main/services/HotkeyService');
    (HotkeyService as { instance?: unknown }).instance = undefined;
    const service = HotkeyService.getInstance(configService, windowManager);
    const shortcuts = (await import('electron')).globalShortcut.__registered as Map<string, () => void>;
    service.registerAll();
    await service.saveAndReloadHotkeys({
      [HotkeyAction.ToggleWindow]: { action: HotkeyAction.ToggleWindow, accelerator: 'Control+X', label: 'Toggle App Window', isEditable: true },
    });
    expect(shortcuts.has('Control+X')).toBe(false);
    expect(shortcuts.has('Control+Space')).toBe(true);
  });

  it('live handlers are reachable through the tray triggers', async () => {
    const { service } = await freshService();
    const interrupt = vi.fn();
    const stop = vi.fn();
    const end = vi.fn();
    service.setLiveInterruptHandlers({ interrupt, stop, end });
    service.triggerStopSpeaking();
    service.triggerEndLive();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('unregisterAll clears every registration', async () => {
    const { service, shortcuts } = await freshService();
    service.registerAll();
    service.unregisterAll();
    expect(shortcuts.size).toBe(0);
  });
});
