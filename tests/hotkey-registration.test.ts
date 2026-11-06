import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HotkeyAction, type HotkeyConfig } from '@shared/types';

const register = vi.fn((_accelerator: string, _callback: () => void): boolean => true);
const unregisterAll = vi.fn();

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => register(accelerator, callback),
    unregisterAll: () => unregisterAll(),
  },
  app: { isPackaged: false, getPath: () => '/tmp' },
}));

let config: { hotkeys: Record<string, HotkeyConfig>; commands?: { commandHotkeys?: Record<string, { accelerator: string }> } };

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({ getConfig: () => config }) },
}));

vi.mock('@main/window', () => ({ WindowManager: class {} }));

import { DEFAULT_HOTKEYS, HotkeyService } from '@main/services/HotkeyService';

function service(): HotkeyService {
  (HotkeyService as unknown as { instance?: unknown }).instance = undefined;
  return HotkeyService.getInstance(
    { getConfig: () => config } as never,
    {} as never
  );
}

function hotkey(action: HotkeyAction, accelerator: string | null): HotkeyConfig {
  return { action, accelerator, label: action, isEditable: true };
}

beforeEach(() => {
  register.mockClear();
  register.mockImplementation(() => true);
  unregisterAll.mockClear();
  config = { hotkeys: {}, commands: { commandHotkeys: {} } };
});

describe('HotkeyService.registerAll conflict handling (plan 58 S3b)', () => {
  it('registers the shipped defaults, including selection speech', () => {
    const hotkeys = service();
    hotkeys.registerAll();
    expect(register).toHaveBeenCalledWith(
      DEFAULT_HOTKEYS[HotkeyAction.SpeakSelection].accelerator,
      expect.any(Function)
    );
    expect(DEFAULT_HOTKEYS[HotkeyAction.PauseSpeaking].accelerator).toBeNull();
  });

  it('reports a collision instead of silently registering nothing', () => {
    config.hotkeys = {
      [HotkeyAction.ToggleWindow]: hotkey(HotkeyAction.ToggleWindow, 'Control+Alt+K'),
      [HotkeyAction.OpenSettings]: hotkey(HotkeyAction.OpenSettings, 'Control+Alt+K'),
    };
    const hotkeys = service();
    const unavailable = vi.fn();
    hotkeys.setHotkeyUnavailableHandler(unavailable);
    hotkeys.registerAll();
    const collided = register.mock.calls.filter(([accelerator]) => accelerator === 'Control+Alt+K');
    expect(collided).toHaveLength(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(unavailable.mock.calls[0][0]).toMatchObject({ accelerator: 'Control+Alt+K' });
  });

  it('treats a refused registration (boolean false) as unavailable', () => {
    register.mockImplementation((accelerator) => accelerator !== 'Control+Space');
    const hotkeys = service();
    const unavailable = vi.fn();
    hotkeys.setHotkeyUnavailableHandler(unavailable);
    hotkeys.registerAll();
    expect(unavailable).toHaveBeenCalledWith(
      expect.objectContaining({ action: HotkeyAction.ToggleWindow, accelerator: 'Control+Space' })
    );
  });
});

describe('HotkeyService.executeAction speech cases', () => {
  function callbackFor(accelerator: string | null): () => void {
    const call = register.mock.calls.find(([candidate]) => candidate === accelerator);
    if (!call) {
      throw new Error(`no registration for ${accelerator}`);
    }
    return call[1];
  }

  it('routes SpeakSelection and PauseSpeaking to the speech bus', () => {
    config.hotkeys = {
      [HotkeyAction.PauseSpeaking]: hotkey(HotkeyAction.PauseSpeaking, 'Control+Alt+P'),
    };
    const hotkeys = service();
    const speech = { speakSelection: vi.fn(), speakClipboard: vi.fn(), togglePause: vi.fn(), stop: vi.fn() };
    hotkeys.setSpeechHandlers(speech);
    hotkeys.registerAll();
    callbackFor(DEFAULT_HOTKEYS[HotkeyAction.SpeakSelection].accelerator)();
    callbackFor('Control+Alt+P')();
    expect(speech.speakSelection).toHaveBeenCalledTimes(1);
    expect(speech.togglePause).toHaveBeenCalledTimes(1);
  });

  it('leaves Stop Speaking on the live/bus arbitration seam', () => {
    const hotkeys = service();
    const interrupt = vi.fn();
    const end = vi.fn();
    hotkeys.setLiveInterruptHandlers({ interrupt, stop: interrupt, end });
    hotkeys.registerAll();
    callbackFor(DEFAULT_HOTKEYS[HotkeyAction.StopSpeaking].accelerator)();
    expect(interrupt).toHaveBeenCalledTimes(1);
  });

  it('exposes tray triggers for clipboard and pause', () => {
    const hotkeys = service();
    const speech = { speakSelection: vi.fn(), speakClipboard: vi.fn(), togglePause: vi.fn(), stop: vi.fn() };
    hotkeys.setSpeechHandlers(speech);
    hotkeys.triggerSpeakClipboard();
    hotkeys.triggerPauseSpeaking();
    expect(speech.speakClipboard).toHaveBeenCalledTimes(1);
    expect(speech.togglePause).toHaveBeenCalledTimes(1);
  });
});
