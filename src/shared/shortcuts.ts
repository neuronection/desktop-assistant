import { HotkeyAction } from '@shared/types';
import { TEXT } from '@shared/constants/text';

/** The sheet's fixed sections (plan 59 D6); an empty section is never rendered. */
export type ShortcutGroupId = 'general' | 'voice' | 'in-window' | 'commands';

export interface ShortcutEntry {
  /** `HotkeyAction` value for built-ins, the command id for command hotkeys. */
  action: string;
  label: string;
  /** `null` = the action exists but no chord is bound (Settings is the next step). */
  accelerator: string | null;
}

export interface ShortcutsView {
  builtIns: ShortcutEntry[];
  commands: ShortcutEntry[];
}

/**
 * Which section an action lives in. Exhaustive on purpose: a new
 * `HotkeyAction` must choose a section instead of silently landing in
 * General. Command hotkeys are the third section by construction.
 */
export const SHORTCUT_GROUPS: Record<HotkeyAction, Exclude<ShortcutGroupId, 'commands'>> = {
  [HotkeyAction.ToggleWindow]: 'general',
  [HotkeyAction.ToggleExpand]: 'general',
  [HotkeyAction.OpenDesktop]: 'general',
  [HotkeyAction.OpenSettings]: 'general',
  [HotkeyAction.OpenCommandPalette]: 'general',
  [HotkeyAction.StartRecording]: 'voice',
  [HotkeyAction.StartLiveConversation]: 'voice',
  [HotkeyAction.StopSpeaking]: 'voice',
  [HotkeyAction.SpeakSelection]: 'voice',
  [HotkeyAction.PauseSpeaking]: 'voice',
};

/** `CommandOrControl+Shift+S` → `Command+Shift+S` (macOS) / `Control+Shift+S` (elsewhere). */
export function displayAccelerator(accelerator: string, isMac: boolean): string {
  return accelerator.replace(/CommandOrControl/gi, isMac ? 'Command' : 'Control');
}

export function detectMacPlatform(platform?: string): boolean {
  const value = platform ?? (typeof navigator !== 'undefined' ? (navigator.platform ?? '') : '');
  return /mac/i.test(value);
}

export interface InWindowShortcut {
  keys: string;
  label: string;
}

/**
 * The canonical in-window chord registry (plan 25 settings note, plan 59
 * D3/D6): the Shortcuts sheet and the Settings hotkeys page read THIS one,
 * so a chord can never be documented in one place and drift in the other.
 */
export const FIXED_IN_WINDOW_SHORTCUTS: InWindowShortcut[] = [
  { keys: 'Control', label: TEXT.HOTKEYS_FIXED_PUSH_TO_TALK },
  { keys: 'Escape', label: TEXT.HOTKEYS_FIXED_ESCAPE },
  { keys: 'Ctrl+E', label: TEXT.HOTKEYS_FIXED_EXPAND },
  { keys: 'Ctrl+D', label: TEXT.HOTKEYS_FIXED_DESKTOP },
  { keys: 'Ctrl+K', label: TEXT.HOTKEYS_FIXED_PALETTE },
  { keys: 'Ctrl+/', label: TEXT.HOTKEYS_FIXED_SHORTCUTS },
];
