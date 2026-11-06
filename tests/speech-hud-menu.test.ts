import { describe, it, expect, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { buildSpeechHudMenuTemplate, type SpeechHudMenuActions } from '@main/speechHudMenu';
import { SPEECH_HUD_STYLES } from '@shared/speechHud';
import { TEXT } from '@shared/constants/text';

function actions(): SpeechHudMenuActions {
  return {
    togglePause: vi.fn(),
    stopSpeech: vi.fn(),
    endLive: vi.fn(),
    openAssistant: vi.fn(),
    openHudSettings: vi.fn(),
    openSpeechSettings: vi.fn(),
    selectSize: vi.fn(),
    openQuickActions: vi.fn(),
    hideHub: vi.fn(),
    selectStyle: vi.fn(),
    toggleKeepOnScreen: vi.fn(),
  };
}

function item(template: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions {
  const found = template.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`missing menu item ${id}`);
  }
  return found;
}

describe('speech HUD native menu (plan 58 addendum)', () => {
  it('offers assistant, HUD/speech settings, style and keep-on-screen in order', () => {
    const template = buildSpeechHudMenuTemplate({ style: 'card', keepOnScreen: false, actions: actions() });
    expect(template.map((entry) => entry.id ?? entry.type)).toEqual([
      'hud-open-assistant',
      'hud-open-hud-settings',
      'hud-open-settings',
      'separator',
      'hud-style',
      'hud-quick-actions',
      'hud-hide',
      'separator',
      'hud-keep-on-screen',
    ]);
    expect(item(template, 'hud-open-assistant').label).toBe(TEXT.SPEECH_HUD_OPEN_ASSISTANT);
    expect(item(template, 'hud-open-hud-settings').label).toBe(TEXT.SPEECH_HUD_MENU_HUD_SETTINGS);
    expect(item(template, 'hud-open-settings').label).toBe(TEXT.SPEECH_HUD_MENU_SETTINGS);
    expect(item(template, 'hud-style').label).toBe(TEXT.VOICE_SPEECH_HUD_STYLE);
    expect(template.some((entry) => entry.id === 'hud-size')).toBe(false);
  });

  it('offers size only where it changes the shape (edge dock)', () => {
    for (const style of ['card', 'dot'] as const) {
      const template = buildSpeechHudMenuTemplate({ style, keepOnScreen: false, actions: actions() });
      expect(template.some((entry) => entry.id === 'hud-size')).toBe(false);
    }
    const edge = buildSpeechHudMenuTemplate({ style: 'edge', keepOnScreen: false, actions: actions() });
    expect(item(edge, 'hud-size').label).toBe(TEXT.HUB_SIZE);
  });

  it('puts pause, stop and end-live first while audio or live is active', () => {
    const handler = actions();
    const template = buildSpeechHudMenuTemplate({
      style: 'card',
      keepOnScreen: false,
      speechActive: true,
      speechPaused: true,
      liveActive: true,
      actions: handler,
    });
    expect(template.slice(0, 4).map((entry) => entry.id ?? entry.type)).toEqual([
      'hud-speech-toggle',
      'hud-speech-stop',
      'hud-live-end',
      'separator',
    ]);
    expect(item(template, 'hud-speech-toggle').label).toBe(TEXT.SPEECH_RESUME);
    (item(template, 'hud-speech-toggle').click as () => void)();
    (item(template, 'hud-speech-stop').click as () => void)();
    (item(template, 'hud-live-end').click as () => void)();
    expect(handler.togglePause).toHaveBeenCalledTimes(1);
    expect(handler.stopSpeech).toHaveBeenCalledTimes(1);
    expect(handler.endLive).toHaveBeenCalledTimes(1);
  });

  it('marks the current style and switches to any of the four', () => {
    const handler = actions();
    const template = buildSpeechHudMenuTemplate({ style: 'edge', keepOnScreen: false, actions: handler });
    const submenu = item(template, 'hud-style').submenu as MenuItemConstructorOptions[];
    expect(submenu).toHaveLength(SPEECH_HUD_STYLES.length);
    for (const style of SPEECH_HUD_STYLES) {
      const entry = submenu.find((candidate) => candidate.id === `hud-style-${style}`)!;
      expect(entry.type).toBe('radio');
      expect(entry.checked).toBe(style === 'edge');
    }
    for (const style of SPEECH_HUD_STYLES) {
      const entry = submenu.find((candidate) => candidate.id === `hud-style-${style}`)!;
      (entry.click as () => void)();
    }
    expect(handler.selectStyle).toHaveBeenCalledTimes(SPEECH_HUD_STYLES.length);
    expect((handler.selectStyle as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual([
      ...SPEECH_HUD_STYLES,
    ]);
  });

  it('wires open assistant, HUD settings, speech settings and the keep-on-screen checkbox', () => {
    const handler = actions();
    const template = buildSpeechHudMenuTemplate({ style: 'card', keepOnScreen: true, actions: handler });
    (item(template, 'hud-open-assistant').click as () => void)();
    (item(template, 'hud-open-hud-settings').click as () => void)();
    (item(template, 'hud-open-settings').click as () => void)();
    const keep = item(template, 'hud-keep-on-screen');
    expect(keep).toMatchObject({ type: 'checkbox', checked: true, label: TEXT.SPEECH_HUD_MENU_KEEP });
    (keep.click as () => void)();
    expect(handler.openAssistant).toHaveBeenCalledTimes(1);
    expect(handler.openHudSettings).toHaveBeenCalledTimes(1);
    expect(handler.openSpeechSettings).toHaveBeenCalledTimes(1);
    expect(handler.toggleKeepOnScreen).toHaveBeenCalledTimes(1);
  });

  it('offers the three size presets and opens HUD settings for Custom', () => {
    const handler = actions();
    const template = buildSpeechHudMenuTemplate({
      style: 'edge',
      sizePreset: 'comfort',
      keepOnScreen: false,
      actions: handler,
    });
    const submenu = item(template, 'hud-size').submenu as MenuItemConstructorOptions[];
    expect(submenu.map((entry) => entry.id ?? entry.type)).toEqual([
      'hud-size-compact',
      'hud-size-comfort',
      'hud-size-large',
      'separator',
      'hud-size-custom',
    ]);
    for (const preset of ['compact', 'comfort', 'large'] as const) {
      const entry = submenu.find((candidate) => candidate.id === `hud-size-${preset}`)!;
      expect(entry.type).toBe('radio');
      expect(entry.checked).toBe(preset === 'comfort');
      (entry.click as () => void)();
    }
    (submenu.find((entry) => entry.id === 'hud-size-custom')!.click as () => void)();
    expect((handler.selectSize as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual([
      'compact',
      'comfort',
      'large',
    ]);
    expect(handler.openHudSettings).toHaveBeenCalledTimes(1);
  });
});
