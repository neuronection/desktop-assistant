import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import { HotkeyAction, type HotkeyConfig } from '@shared/types';

function hotkey(action: HotkeyAction, accelerator: string | null): HotkeyConfig {
  return { action, accelerator, label: action, isEditable: true };
}

function withHotkeys(entry: HotkeyConfig): Partial<AppConfig> {
  return { hotkeys: { [entry.action]: entry } } as unknown as Partial<AppConfig>;
}

describe('hotkey defaults', () => {
  it('opens the launcher with Control+Space', () => {
    expect(DEFAULT_CONFIG.hotkeys[HotkeyAction.ToggleWindow].accelerator).toBe('Control+Space');
  });

  it('leaves the global voice hotkey unbound (in-window push-to-talk)', () => {
    expect(DEFAULT_CONFIG.hotkeys[HotkeyAction.StartRecording].accelerator).toBeNull();
  });

  it('binds the global stop-speaking / interrupt hotkey by default', () => {
    expect(DEFAULT_CONFIG.hotkeys[HotkeyAction.StopSpeaking].accelerator).toBe('CommandOrControl+Shift+Space');
  });

  it('binds a global start-live-conversation hotkey by default', () => {
    expect(DEFAULT_CONFIG.hotkeys[HotkeyAction.StartLiveConversation].accelerator).toBe('CommandOrControl+Alt+Space');
  });

  it('preserves a user-customized accelerator', () => {
    const merged = mergeWithDefaults(withHotkeys(hotkey(HotkeyAction.ToggleWindow, 'Alt+J')));
    expect(merged.hotkeys[HotkeyAction.ToggleWindow].accelerator).toBe('Alt+J');
  });
});
