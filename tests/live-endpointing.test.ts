import { describe, it, expect } from 'vitest';
import {
  LIVE_PHRASE_GAP_MS_DEFAULT,
  STANDARD_PHRASE_GAP_MS_DEFAULT,
  resolvePhraseGapMs,
} from '@shared/live';

describe('live endpointing profile (plan 25 S3)', () => {
  it('uses the shorter live gap in live mode', () => {
    expect(resolvePhraseGapMs({ phraseGapMs: 700, livePhraseGapMs: 400 }, true)).toBe(400);
  });

  it('uses the standard gap outside live mode', () => {
    expect(resolvePhraseGapMs({ phraseGapMs: 1000, livePhraseGapMs: 400 }, false)).toBe(1000);
  });

  it('falls back to defaults for missing or invalid values', () => {
    expect(resolvePhraseGapMs(undefined, true)).toBe(LIVE_PHRASE_GAP_MS_DEFAULT);
    expect(resolvePhraseGapMs(undefined, false)).toBe(STANDARD_PHRASE_GAP_MS_DEFAULT);
    expect(resolvePhraseGapMs({ livePhraseGapMs: 0 }, true)).toBe(LIVE_PHRASE_GAP_MS_DEFAULT);
    expect(resolvePhraseGapMs({ phraseGapMs: -5 }, false)).toBe(STANDARD_PHRASE_GAP_MS_DEFAULT);
  });
});
