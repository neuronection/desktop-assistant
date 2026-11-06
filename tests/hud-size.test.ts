import { describe, expect, it } from 'vitest';
import {
  HUD_DEFAULT_SIZE_PRESET,
  HUD_SIZE_TOKENS,
  clampHudCustomSize,
  hudSizeTokens,
  speechEdgeFaceSize,
  speechHudBox,
} from '@shared/speechHud';

describe('HUD size presets', () => {
  it('ships coherent Compact, Comfort and Large tokens', () => {
    expect(HUD_DEFAULT_SIZE_PRESET).toBe('comfort');
    expect(HUD_SIZE_TOKENS.comfort).toMatchObject({
      faceWidth: 220,
      controlSize: 22,
      textSize: 12,
      window: { width: 240, height: 97 },
    });
    expect(HUD_SIZE_TOKENS.compact).toMatchObject({
      faceWidth: 204,
      controlSize: 22,
      textSize: 11,
    });
    expect(HUD_SIZE_TOKENS.large).toMatchObject({
      faceWidth: 240,
      controlSize: 26,
      textSize: 13,
    });
  });

  it('collapses the empty face to the control strip', () => {
    for (const preset of ['compact', 'comfort', 'large'] as const) {
      const size = HUD_SIZE_TOKENS[preset];
      expect(size.faceHeights.empty).toBe(size.controlSize + 3);
    }
  });

  it('derives the face and envelope from the selected token set', () => {
    const comfort = hudSizeTokens('comfort');
    expect(comfort.faceHeights.single).toBe(48);
    expect(comfort.faceHeights.multi).toBe(77);
    expect(speechEdgeFaceSize('multi', comfort)).toEqual({ width: 220, height: 77 });
    expect(speechHudBox('edge', 'top', { text: true, size: comfort })).toMatchObject({
      width: 240,
      height: 97,
    });
  });

  it('clamps Custom to a seven-control face and safe text/control ranges', () => {
    expect(clampHudCustomSize({ faceWidth: 10, controlSize: 30, textSize: 99 })).toEqual({
      faceWidth: 260,
      controlSize: 30,
      textSize: 14,
    });
    expect(hudSizeTokens('custom', { faceWidth: 240, controlSize: 26, textSize: 13 })).toMatchObject({
      mode: 'custom',
      faceWidth: 240,
      controlSize: 26,
      textSize: 13,
      window: { width: 260, height: 104 },
    });
  });
});
