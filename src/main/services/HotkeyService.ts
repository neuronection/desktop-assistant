// src/main/services/HotkeyService.ts

import { globalShortcut } from 'electron';
import { HotkeyAction, type HotkeyConfig, type HotkeySettings } from '@shared/types';
import type { ShortcutsView } from '@shared/shortcuts';
import { TEXT } from '@shared/constants/text';
import { MainConfigService } from '@main/services/ConfigService';
import { WindowManager } from '@main/window';

// Define the default hotkey configuration
export const DEFAULT_HOTKEYS: HotkeySettings = {
  [HotkeyAction.ToggleWindow]: {
    action: HotkeyAction.ToggleWindow,
    accelerator: 'Control+Space',
    label: 'Toggle App Window',
    isEditable: true,
  },
  [HotkeyAction.OpenSettings]: {
    action: HotkeyAction.OpenSettings,
    accelerator: 'CommandOrControl+,',
    label: 'Open Settings',
    isEditable: true,
  },
  [HotkeyAction.StartRecording]: {
      action: HotkeyAction.StartRecording,
      accelerator: null,
      label: 'Start Voice Recording',
      isEditable: true
  },
  [HotkeyAction.ToggleExpand]: {
    action: HotkeyAction.ToggleExpand,
    accelerator: null,
    label: 'Expand/Collapse Launcher',
    isEditable: true,
  },
  [HotkeyAction.OpenDesktop]: {
    action: HotkeyAction.OpenDesktop,
    accelerator: null,
    label: 'Open Desktop Mode',
    isEditable: true,
  },
  [HotkeyAction.OpenCommandPalette]: {
    action: HotkeyAction.OpenCommandPalette,
    accelerator: null,
    label: 'Open Command Palette',
    isEditable: true,
  },
  [HotkeyAction.StopSpeaking]: {
    action: HotkeyAction.StopSpeaking,
    accelerator: 'CommandOrControl+Shift+Space',
    label: 'Stop Speaking / Interrupt',
    isEditable: true,
  },
  [HotkeyAction.SpeakSelection]: {
    action: HotkeyAction.SpeakSelection,
    accelerator: 'CommandOrControl+Shift+S',
    label: TEXT.SPEECH_HOTKEY_SPEAK_SELECTION,
    isEditable: true,
  },
  [HotkeyAction.PauseSpeaking]: {
    action: HotkeyAction.PauseSpeaking,
    accelerator: null,
    label: TEXT.SPEECH_HOTKEY_PAUSE_SPEAKING,
    isEditable: true,
  },
  [HotkeyAction.StartLiveConversation]: {
    action: HotkeyAction.StartLiveConversation,
    accelerator: 'CommandOrControl+Alt+Space',
    label: 'Start Live Conversation',
    isEditable: true,
  }
};

export interface SpeechHotkeyHandlers {
  speakSelection(): void;
  speakClipboard(): void;
  togglePause(): void;
  replayLast(): void;
  stop(): void;
}

export class HotkeyService {
  private static instance: HotkeyService;
  private configService: MainConfigService;
  private windowManager: WindowManager;
  private currentHotkeys: HotkeySettings;
  /** Main-side executor for custom-command hotkeys (plan 12 §4). */
  private commandRunner: ((commandId: string) => void) | null = null;
  /** Live-mode interruption handlers (plan 25 D9), wired from the IPC layer. */
  private liveInterrupt: (() => void) | null = null;
  private liveStop: (() => void) | null = null;
  private liveEnd: (() => void) | null = null;
  private speechHandlers: SpeechHotkeyHandlers | null = null;
  private unavailableHandler: ((hotkey: HotkeyConfig) => void) | null = null;
  private commandLabelResolver: ((commandId: string) => string | null) | null = null;

  private constructor(configService: MainConfigService, windowManager: WindowManager) {
    this.configService = configService;
    this.windowManager = windowManager;
    this.currentHotkeys = this.loadHotkeys();
  }

  public static getInstance(configService: MainConfigService, windowManager: WindowManager): HotkeyService {
    if (!HotkeyService.instance) {
      HotkeyService.instance = new HotkeyService(configService, windowManager);
    }
    return HotkeyService.instance;
  }

  /** Wired from the IPC layer once CommandService/TurnManager exist. */
  public setCommandRunner(runner: (commandId: string) => void): void {
    this.commandRunner = runner;
  }

  /** Wired from the IPC layer once the speech bus exists (plan 58 S3b). */
  public setSpeechHandlers(handlers: SpeechHotkeyHandlers): void {
    this.speechHandlers = handlers;
  }

  /** Surfaces a silently dead trigger (plan 58 S3b): collision or refused registration. */
  public setHotkeyUnavailableHandler(handler: (hotkey: HotkeyConfig) => void): void {
    this.unavailableHandler = handler;
  }

  /** Wired from the IPC layer once the live session exists (plan 25 D9). */
  public setLiveInterruptHandlers(handlers: {
    interrupt: () => void;
    stop: () => void;
    end: () => void;
  }): void {
    this.liveInterrupt = handlers.interrupt;
    this.liveStop = handlers.stop;
    this.liveEnd = handlers.end;
  }

  /** Tray → Stop speaking (live or the speech bus, whichever owns sound). */
  public triggerStopSpeaking(): void {
    this.liveStop?.();
  }

  /** Tray → speak the clipboard through the bus. */
  public triggerSpeakClipboard(): void {
    this.speechHandlers?.speakClipboard();
  }

  /** Tray → pause/resume the bus. */
  public triggerPauseSpeaking(): void {
    this.speechHandlers?.togglePause();
  }

  /** Tray → replay the last utterance (plan 58 S6b). */
  public triggerReplayLast(): void {
    this.speechHandlers?.replayLast();
  }

  /**
   * Tray/hotkey → Start live in the HUD. The launcher is the live UI's
   * engine client, not the surface: keep it hidden when it already exists
   * and let the handoff hide it once the host reports listening (plan 62).
   */
  public triggerStartLive(): void {
    const main = this.windowManager.getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send('hotkey:start-live');
      return;
    }
    this.windowManager.showMainWindow();
    this.windowManager.getMainWindow()?.webContents.send('hotkey:start-live');
  }

  /** Tray → End live conversation. */
  public triggerEndLive(): void {
    this.liveEnd?.();
  }

  private commandBindings(): { commandId: string; accelerator: string }[] {
    const hotkeys = this.configService.getConfig().commands?.commandHotkeys ?? {};
    return Object.entries(hotkeys)
      .filter((entry): entry is [string, { accelerator: string }] => Boolean(entry[1]?.accelerator))
      .map(([commandId, binding]) => ({ commandId, accelerator: binding.accelerator }));
  }

  private loadHotkeys(): HotkeySettings {
    const config = this.configService.getConfig();
    // Merge saved hotkeys with defaults to ensure all actions are covered
    return {
      ...DEFAULT_HOTKEYS,
      ...(config.hotkeys || {}),
    };
  }

  public getSettings(): HotkeySettings {
    return this.currentHotkeys;
  }

  /**
   * Command titles for the shortcuts sheet (plan 59 D2), wired at the IPC
   * root. `null` means the bound command no longer exists (deleted command
   * or removed pack) — the row is dropped instead of leaking a raw id.
   */
  public setCommandLabelResolver(resolver: (commandId: string) => string | null): void {
    this.commandLabelResolver = resolver;
  }

  /**
   * Read-only cheat-sheet data (plan 59 D2): every built-in action (with
   * `null` when unbound) plus every bound command hotkey. Read live on each
   * call — the sheet must never show a cached chord (D5).
   */
  public getShortcuts(): ShortcutsView {
    const builtIns = Object.values(this.currentHotkeys).map((hotkey) => ({
      action: hotkey.action as string,
      // Labels come from the shipped defaults, never the persisted copy: a
      // shallow config merge would otherwise keep a stale renamed label.
      label: DEFAULT_HOTKEYS[hotkey.action]?.label ?? hotkey.label,
      accelerator: hotkey.accelerator,
    }));
    const commands = this.commandBindings().flatMap(({ commandId, accelerator }) => {
      const label = this.commandLabelResolver?.(commandId) ?? null;
      return label ? [{ action: commandId, label, accelerator }] : [];
    });
    return { builtIns, commands };
  }

  public async saveAndReloadHotkeys(newSettings: Partial<HotkeySettings>): Promise<void> {
    const currentConfig = this.configService.getConfig();
    
    // Merge the partial new settings with the existing hotkey settings
    const updatedHotkeys: HotkeySettings = { ...this.currentHotkeys };
    for (const key in newSettings) {
        const action = key as HotkeyAction;
        if(updatedHotkeys[action] && updatedHotkeys[action].isEditable) {
            updatedHotkeys[action].accelerator = newSettings[action]?.accelerator || null;
        }
    }

    // Update the main config object
    await this.configService.updateConfig({ ...currentConfig, hotkeys: updatedHotkeys });
    
    // Reload hotkeys from the source of truth (config) and re-register
    this.currentHotkeys = this.loadHotkeys();
    this.registerAll();
  }

  public registerAll(): void {
    globalShortcut.unregisterAll();
    const taken = new Set<string>();
    for (const hotkey of Object.values(this.currentHotkeys)) {
      if (!hotkey.accelerator) {
        continue;
      }
      if (taken.has(hotkey.accelerator)) {
        this.reportUnavailable(hotkey);
        continue;
      }
      taken.add(hotkey.accelerator);
      let registered = false;
      try {
        registered = globalShortcut.register(hotkey.accelerator, () => {
          this.executeAction(hotkey.action);
        });
      } catch (error) {
        console.error(`Failed to register hotkey "${hotkey.accelerator}" for ${hotkey.label}:`, error);
      }
      if (!registered) {
        this.reportUnavailable(hotkey);
        continue;
      }
      console.log(`Registered: ${hotkey.label} -> ${hotkey.accelerator}`);
    }
    for (const { commandId, accelerator } of this.commandBindings()) {
      if (taken.has(accelerator)) {
        console.warn(`Skipping command hotkey for '${commandId}': '${accelerator}' is already in use.`);
        continue;
      }
      taken.add(accelerator);
      let registered = false;
      try {
        registered = globalShortcut.register(accelerator, () => {
          this.commandRunner?.(commandId);
        });
      } catch (error) {
        console.error(`Failed to register command hotkey "${accelerator}" for '${commandId}':`, error);
      }
      if (!registered) {
        this.reportUnavailable({
          action: HotkeyAction.OpenCommandPalette,
          accelerator,
          label: commandId,
          isEditable: true,
        });
        continue;
      }
      console.log(`Registered command hotkey: ${commandId} -> ${accelerator}`);
    }
  }

  private reportUnavailable(hotkey: HotkeyConfig): void {
    console.warn(`Hotkey unavailable: ${hotkey.label} -> ${hotkey.accelerator}`);
    this.unavailableHandler?.(hotkey);
  }

  public unregisterAll(): void {
    globalShortcut.unregisterAll();
  }

  private executeAction(action: HotkeyAction): void {
    console.log(`Executing hotkey action: ${action}`);
    switch (action) {
      case HotkeyAction.ToggleWindow:
        this.windowManager.toggleMainWindow();
        break;
      case HotkeyAction.OpenSettings:
        this.windowManager.showSettingsWindow();
        break;
      case HotkeyAction.StartRecording:
        this.windowManager.getMainWindow()?.webContents.send('hotkey:start-recording');
        break;
      case HotkeyAction.ToggleExpand:
        this.windowManager.getMainWindow()?.webContents.send('launcher:toggle-expand');
        break;
      case HotkeyAction.OpenDesktop:
        void this.windowManager.showDesktopWindow();
        break;
      case HotkeyAction.OpenCommandPalette:
        this.windowManager.toggleMainWindow();
        this.windowManager.getMainWindow()?.webContents.send('launcher:open-palette');
        break;
      case HotkeyAction.StopSpeaking:
        this.liveInterrupt?.();
        break;
      case HotkeyAction.SpeakSelection:
        this.speechHandlers?.speakSelection();
        break;
      case HotkeyAction.PauseSpeaking:
        this.speechHandlers?.togglePause();
        break;
      case HotkeyAction.StartLiveConversation:
        this.triggerStartLive();
        break;
      // Add other cases as needed
    }
  }
}