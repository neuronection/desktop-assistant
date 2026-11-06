import type { MenuItemConstructorOptions } from 'electron';
import {
  HUD_SIZE_PRESETS,
  SPEECH_HUD_STYLES,
  type HudSizeMode,
  type HudSizePreset,
  type SpeechHudStyle,
} from '@shared/speechHud';
import { TEXT } from '@shared/constants/text';

export const SPEECH_HUD_STYLE_LABELS: Record<SpeechHudStyle, string> = {
  card: TEXT.VOICE_SPEECH_HUD_STYLE_CARD,
  edge: TEXT.VOICE_SPEECH_HUD_STYLE_EDGE,
  dot: TEXT.VOICE_SPEECH_HUD_STYLE_DOT,
};

export const SPEECH_HUD_SIZE_LABELS: Record<HudSizePreset, string> = {
  compact: TEXT.HUB_SIZE_COMPACT,
  comfort: TEXT.HUB_SIZE_COMFORT,
  large: TEXT.HUB_SIZE_LARGE,
};

export interface SpeechHudMenuActions {
  togglePause(): void;
  stopSpeech(): void;
  endLive(): void;
  openAssistant(): void;
  openHudSettings(): void;
  openSpeechSettings(): void;
  selectSize(preset: HudSizePreset): void;
  openQuickActions(): void;
  hideHub(): void;
  selectStyle(style: SpeechHudStyle): void;
  toggleKeepOnScreen(): void;
}

/**
 * The native HUD menu (plan 58 addendum): the textless surfaces are too
 * small for an extra control, so navigation lives one right-click away.
 * A native menu can extend past the 28 px orb and does not fight the
 * primary click (stop / interrupt / pause). Pure template so the order and
 * wiring are testable without Electron.
 */
export function buildSpeechHudMenuTemplate(input: {
  style: SpeechHudStyle;
  sizePreset?: HudSizeMode;
  keepOnScreen: boolean;
  speechActive?: boolean;
  speechPaused?: boolean;
  liveActive?: boolean;
  actions: SpeechHudMenuActions;
}): MenuItemConstructorOptions[] {
  return [
    ...(input.speechActive
      ? [
          {
            id: 'hud-speech-toggle',
            label: input.speechPaused ? TEXT.SPEECH_RESUME : TEXT.SPEECH_PAUSE,
            click: () => input.actions.togglePause(),
          },
          {
            id: 'hud-speech-stop',
            label: TEXT.SPEECH_STOP,
            click: () => input.actions.stopSpeech(),
          },
        ]
      : []),
    ...(input.liveActive
      ? [
          {
            id: 'hud-live-end',
            label: TEXT.SPEECH_LIVE_END,
            click: () => input.actions.endLive(),
          },
        ]
      : []),
    ...(input.speechActive || input.liveActive ? [{ type: 'separator' as const }] : []),
    {
      id: 'hud-open-assistant',
      label: TEXT.SPEECH_HUD_OPEN_ASSISTANT,
      click: () => input.actions.openAssistant(),
    },
    {
      id: 'hud-open-hud-settings',
      label: TEXT.SPEECH_HUD_MENU_HUD_SETTINGS,
      click: () => input.actions.openHudSettings(),
    },
    {
      id: 'hud-open-settings',
      label: TEXT.SPEECH_HUD_MENU_SETTINGS,
      click: () => input.actions.openSpeechSettings(),
    },
    { type: 'separator' },
    {
      id: 'hud-style',
      label: TEXT.VOICE_SPEECH_HUD_STYLE,
      submenu: SPEECH_HUD_STYLES.map((style) => ({
        id: `hud-style-${style}`,
        label: SPEECH_HUD_STYLE_LABELS[style],
        type: 'radio' as const,
        checked: style === input.style,
        click: () => input.actions.selectStyle(style),
      })),
    },
    ...(input.style === 'edge'
      ? [
          {
            id: 'hud-size',
            label: TEXT.HUB_SIZE,
            submenu: [
              ...HUD_SIZE_PRESETS.map((preset) => ({
                id: `hud-size-${preset}`,
                label: SPEECH_HUD_SIZE_LABELS[preset],
                type: 'radio' as const,
                checked: preset === (input.sizePreset ?? 'comfort'),
                click: () => input.actions.selectSize(preset),
              })),
              { type: 'separator' as const },
              {
                id: 'hud-size-custom',
                label: `${TEXT.HUB_SIZE_CUSTOM}…`,
                click: () => input.actions.openHudSettings(),
              },
            ],
          },
        ]
      : []),
    {
      id: 'hud-quick-actions',
      label: TEXT.HUB_MENU_QUICK_ACTIONS,
      click: () => input.actions.openQuickActions(),
    },
    {
      id: 'hud-hide',
      label: TEXT.HUB_ACTION_HIDE,
      click: () => input.actions.hideHub(),
    },
    { type: 'separator' },
    {
      id: 'hud-keep-on-screen',
      label: TEXT.SPEECH_HUD_MENU_KEEP,
      type: 'checkbox',
      checked: input.keepOnScreen,
      click: () => input.actions.toggleKeepOnScreen(),
    },
  ];
}
