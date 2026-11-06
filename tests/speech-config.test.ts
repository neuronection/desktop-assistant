import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  mergeWithDefaults,
  sanitizeConfigForSave,
  sanitizeSpeechSettings,
  type AppConfig,
} from '@shared/config/AppConfig';
import type { VoiceSettings } from '@shared/types';

function merged(voice: Partial<VoiceSettings>): AppConfig {
  return mergeWithDefaults({ voice } as Partial<AppConfig>);
}

describe('speech voice config (plan 58 D5/D12)', () => {
  it('ships the documented defaults', () => {
    expect(DEFAULT_CONFIG.voice).toMatchObject({
      speechCache: true,
      speechCacheMaxUtterances: 50,
      speechCacheMaxBytes: 512 * 1024 * 1024,
      speechSpeed: 1,
      speechVoice: '',
      selectionMaxChars: 8000,
      speechHudPosture: 'auto',
      speechHudCorner: 'bottom-right',
      speechHudStyle: 'card',
      speechHudEdgeSide: 'right',
      speechHudEdgeRatio: 0.5,
      speechHudDotXRatio: 1,
      speechHudDotYRatio: 1,
      hudContentProtection: false,
      hubDockText: 'latest',
      hubDockWidth: 'auto',
      hubQuickActions: ['live-toggle', 'translate-selection', 'speak-selection', 'dictate', 'open-assistant', 'hide-hub'],
      hubTabActions: ['translate-selection', 'open-assistant'],
      hubDotActions: ['speak-selection', 'dictate', 'live-toggle'],
      hubLiveOnTab: true,
      hubResultAutoHideMs: 10_000,
      hudPreset: 'pulse',
      hudControls: 'auto',
      hudMotion: true,
      hudTextScale: 1,
      hudSizePreset: 'comfort',
      hudCustomSize: { faceWidth: 220, controlSize: 22, textSize: 12 },
    });
  });

  it('normalizes hub action lists by dropping unknown/duplicate ids and capping the tab list', () => {
    const normalized = merged({
      hubQuickActions: ['dictate', 'nope', 'dictate', 'live-toggle'] as VoiceSettings['hubQuickActions'],
      hubTabActions: ['live-toggle', 'open-assistant', 'dictate', 'hide-hub'] as VoiceSettings['hubTabActions'],
    });
    expect(normalized.voice.hubQuickActions).toEqual(['dictate', 'live-toggle']);
    expect(normalized.voice.hubTabActions).toEqual(['open-assistant', 'dictate']);
  });

  it('falls back to safe Studio and dock values', () => {
    expect(
      merged({
        hubDockWidth: 'wide' as unknown as VoiceSettings['hubDockWidth'],
        hudPreset: 'disco' as unknown as VoiceSettings['hudPreset'],
        hudControls: 'sometimes' as unknown as VoiceSettings['hudControls'],
      }).voice
    ).toMatchObject({ hubDockWidth: 'auto', hudPreset: 'pulse', hudControls: 'auto' });
    expect(merged({ hudTextScale: 5 }).voice.hudTextScale).toBe(1.2);
    expect(merged({ hudTextScale: 0 }).voice.hudTextScale).toBe(0.9);
    expect(
      merged({ hudSizePreset: 'huge' as unknown as VoiceSettings['hudSizePreset'] }).voice.hudSizePreset
    ).toBe('comfort');
    expect(
      merged({
        hudSizePreset: 'custom',
        hudCustomSize: { faceWidth: 999, controlSize: 999, textSize: 999 },
      }).voice.hudCustomSize
    ).toEqual({ faceWidth: 280, controlSize: 30, textSize: 14 });
    expect(merged({ hubResultAutoHideMs: 1 }).voice.hubResultAutoHideMs).toBe(3000);
    expect(merged({ hubResultAutoHideMs: 120_000 }).voice.hubResultAutoHideMs).toBe(60_000);
  });

  it('keeps every sibling voice default on a partial save (one-level merge)', () => {
    const config = merged({ speechHudPosture: 'pinned' });
    expect(config.voice.speechHudPosture).toBe('pinned');
    expect(config.voice.speechHudCorner).toBe('bottom-right');
    expect(config.voice.speechCache).toBe(true);
    expect(config.voice.speechSpeed).toBe(1);
    expect(config.voice.language).toBe('auto');
    expect(config.voice.phraseGapMs).toBe(700);
    expect(config.voice.speakReplies).toBe(false);
  });

  it('migrates the legacy text scale into a Custom size', () => {
    const custom = sanitizeSpeechSettings({ hudTextScale: 1.2, hubDockWidth: 'auto' });
    expect(custom.hudSizePreset).toBe('custom');
    expect(custom.hudCustomSize).toMatchObject({ faceWidth: 220, controlSize: 22, textSize: 13 });
    const compact = sanitizeSpeechSettings({ hubDockWidth: 30 });
    expect(compact.hubDockText).toBe('off');
  });

  it('clamps speed into 0.5–2 on a 0.05 step and survives NaN', () => {
    expect(merged({ speechSpeed: 5 }).voice.speechSpeed).toBe(2);
    expect(merged({ speechSpeed: 0.1 }).voice.speechSpeed).toBe(0.5);
    expect(merged({ speechSpeed: 1.03 }).voice.speechSpeed).toBe(1.05);
    expect(merged({ speechSpeed: Number.NaN }).voice.speechSpeed).toBe(1);
    expect(merged({ speechSpeed: Number.POSITIVE_INFINITY }).voice.speechSpeed).toBe(1);
  });

  it('clamps the selection cost guard and cache budgets', () => {
    expect(merged({ selectionMaxChars: 1_000_000 }).voice.selectionMaxChars).toBe(20_000);
    expect(merged({ selectionMaxChars: 0 }).voice.selectionMaxChars).toBe(500);
    expect(merged({ speechCacheMaxUtterances: 0 }).voice.speechCacheMaxUtterances).toBe(1);
    expect(merged({ speechCacheMaxUtterances: 10_000 }).voice.speechCacheMaxUtterances).toBe(500);
    expect(merged({ speechCacheMaxBytes: -1 }).voice.speechCacheMaxBytes).toBe(8 * 1024 * 1024);
  });

  it('clamps the HUD style, dock and position keys', () => {
    expect(merged({ speechHudStyle: 'hologram' as never }).voice.speechHudStyle).toBe('card');
    expect(merged({ speechHudEdgeSide: 'diagonal' as never }).voice.speechHudEdgeSide).toBe('right');
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      expect(merged({ speechHudEdgeSide: side }).voice.speechHudEdgeSide).toBe(side);
    }
    expect(merged({ speechHudEdgeRatio: -1 }).voice.speechHudEdgeRatio).toBe(0);
    expect(merged({ speechHudEdgeRatio: 4 }).voice.speechHudEdgeRatio).toBe(1);
    expect(merged({ speechHudDotXRatio: Number.NaN }).voice.speechHudDotXRatio).toBe(1);
    expect(merged({ speechHudDotYRatio: 0.1234 }).voice.speechHudDotYRatio).toBe(0.123);
    expect(merged({ speechHudStyle: 'dot' }).voice.speechHudStyle).toBe('dot');
    expect(merged({ speechHudStyle: 'mini' as never }).voice.speechHudStyle).toBe('dot');
  });

  it('normalizes the dot action list against the closed catalog', () => {
    expect(merged({ hubDotActions: [] }).voice.hubDotActions).toEqual([]);
    expect(
      merged({ hubDotActions: ['dictate', 'dictate', 'live-toggle'] }).voice.hubDotActions
    ).toEqual(['dictate', 'live-toggle']);
    expect(
      merged({ hubDotActions: ['open-assistant', 'speak-selection'] as never }).voice.hubDotActions
    ).toEqual(['speak-selection']);
    expect(
      merged({ hubDotActions: 'nope' as never }).voice.hubDotActions
    ).toEqual([]);
  });

  it('falls back to defaults for unknown enum and non-boolean values', () => {
    const config = merged({
      speechHudPosture: 'sometimes' as VoiceSettings['speechHudPosture'],
      speechHudCorner: 'middle' as VoiceSettings['speechHudCorner'],
      speechCache: 'yes' as unknown as boolean,
      hudContentProtection: 1 as unknown as boolean,
    });
    expect(config.voice.speechHudPosture).toBe('auto');
    expect(config.voice.speechHudCorner).toBe('bottom-right');
    expect(config.voice.speechCache).toBe(true);
    expect(config.voice.hudContentProtection).toBe(false);
  });

  it('never lets the narrow boundary leak unrelated voice keys', () => {
    expect(sanitizeSpeechSettings({ language: 'el', speechSpeed: 1.5 })).toEqual({
      speechCache: true,
      speechCacheMaxUtterances: 50,
      speechCacheMaxBytes: 512 * 1024 * 1024,
      speechSpeed: 1.5,
      speechVoice: '',
      selectionMaxChars: 8000,
      speechHudPosture: 'auto',
      speechHudCorner: 'bottom-right',
      speechHudStyle: 'card',
      speechHudEdgeSide: 'right',
      speechHudEdgeRatio: 0.5,
      speechHudDotXRatio: 1,
      speechHudDotYRatio: 1,
      hudContentProtection: false,
      hubDockText: 'latest',
      hubDockWidth: 'auto',
      hubQuickActions: ['live-toggle', 'translate-selection', 'speak-selection', 'dictate', 'open-assistant', 'hide-hub'],
      hubTabActions: ['translate-selection', 'open-assistant'],
      hubDotActions: ['speak-selection', 'dictate', 'live-toggle'],
      hubLiveOnTab: true,
      hubResultAutoHideMs: 10_000,
      hudPreset: 'pulse',
      hudControls: 'auto',
      hudMotion: true,
      hudTextScale: 1,
      hudSizePreset: 'comfort',
      hudCustomSize: { faceWidth: 220, controlSize: 22, textSize: 12 },
    });
  });

  it('normalizes hub action lists by dropping unknown/duplicate ids and capping the tab list', () => {
    const normalized = merged({
      hubQuickActions: ['dictate', 'nope', 'dictate', 'live-toggle'] as VoiceSettings['hubQuickActions'],
      hubTabActions: ['live-toggle', 'open-assistant', 'dictate', 'hide-hub'] as VoiceSettings['hubTabActions'],
    });
    expect(normalized.voice.hubQuickActions).toEqual(['dictate', 'live-toggle']);
    expect(normalized.voice.hubTabActions).toEqual(['open-assistant', 'dictate']);
  });

  it('falls back to safe Studio and dock values', () => {
    expect(
      merged({
        hubDockWidth: 'wide' as unknown as VoiceSettings['hubDockWidth'],
        hudPreset: 'disco' as unknown as VoiceSettings['hudPreset'],
        hudControls: 'sometimes' as unknown as VoiceSettings['hudControls'],
      }).voice
    ).toMatchObject({ hubDockWidth: 'auto', hudPreset: 'pulse', hudControls: 'auto' });
    expect(merged({ hudTextScale: 5 }).voice.hudTextScale).toBe(1.2);
    expect(merged({ hudTextScale: 0 }).voice.hudTextScale).toBe(0.9);
    expect(
      merged({ hudSizePreset: 'huge' as unknown as VoiceSettings['hudSizePreset'] }).voice.hudSizePreset
    ).toBe('comfort');
    expect(
      merged({
        hudSizePreset: 'custom',
        hudCustomSize: { faceWidth: 999, controlSize: 999, textSize: 999 },
      }).voice.hudCustomSize
    ).toEqual({ faceWidth: 280, controlSize: 30, textSize: 14 });
    expect(merged({ hubResultAutoHideMs: 1 }).voice.hubResultAutoHideMs).toBe(3000);
    expect(merged({ hubResultAutoHideMs: 120_000 }).voice.hubResultAutoHideMs).toBe(60_000);
  });

  it('writes clamped values back on save', () => {
    const saved = sanitizeConfigForSave(merged({ speechSpeed: 9, selectionMaxChars: 99_999 }));
    expect(saved.voice.speechSpeed).toBe(2);
    expect(saved.voice.selectionMaxChars).toBe(20_000);
  });

  it('trims the voice, strips control characters and caps the length', () => {
    expect(merged({ speechVoice: '  af_sky+af_bella  ' }).voice.speechVoice).toBe('af_sky+af_bella');
    expect(merged({ speechVoice: 'no\u0000va\u007f' }).voice.speechVoice).toBe('nova');
    expect(merged({ speechVoice: 'x'.repeat(500) }).voice.speechVoice).toHaveLength(120);
    expect(merged({ speechVoice: 42 as unknown as string }).voice.speechVoice).toBe('');
  });

  it('keeps the voice on a partial save', () => {
    const saved = sanitizeConfigForSave(merged({ speechVoice: 'Kore' }));
    expect(saved.voice.speechVoice).toBe('Kore');
  });
});
