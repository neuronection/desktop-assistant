import { describe, expect, it } from 'vitest';
import {
  chooseOcrEngine,
  condenseOcrQuery,
  normaliseOcrText,
  tesseractLanguage,
} from '@shared/ai/ocr';

describe('OCR engine selection', () => {
  it('prefers the local engine: free and no egress', () => {
    expect(chooseOcrEngine({ localAvailable: true, modelAvailable: true, modelAllowed: true })).toEqual({
      engine: 'local',
      reason: null,
    });
  });

  it('falls back to the model when it is allowed', () => {
    expect(chooseOcrEngine({ localAvailable: false, modelAvailable: true, modelAllowed: true }).engine).toBe('model');
  });

  it('says blocked when the policy is the reason, not "none"', () => {
    expect(chooseOcrEngine({ localAvailable: false, modelAvailable: true, modelAllowed: false })).toEqual({
      engine: null,
      reason: 'blocked',
    });
  });

  it('says none when there is no engine at all', () => {
    expect(chooseOcrEngine({ localAvailable: false, modelAvailable: false, modelAllowed: false })).toEqual({
      engine: null,
      reason: 'none',
    });
  });
});

describe('tesseract language mapping', () => {
  it('maps app locales to traineddata codes', () => {
    expect(tesseractLanguage('el-GR')).toBe('ell');
    expect(tesseractLanguage('de')).toBe('deu');
    expect(tesseractLanguage('zh-Hant-TW')).toBe('chi_sim');
    expect(tesseractLanguage('en_US')).toBe('eng');
  });

  it('falls back to English for unknown or missing locales', () => {
    expect(tesseractLanguage('xx')).toBe('eng');
    expect(tesseractLanguage(undefined)).toBe('eng');
  });
});

describe('OCR text normalisation', () => {
  it('trims, normalises line endings and unwraps a fenced block', () => {
    expect(normaliseOcrText('```text\r\nHello\r\nWorld\r\n```')).toBe('Hello\nWorld');
    expect(normaliseOcrText('  plain  ')).toBe('plain');
  });

  it('caps very long output', () => {
    expect(normaliseOcrText('x'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('search query condensing', () => {
  it('takes the first non-empty line and collapses spaces', () => {
    expect(condenseOcrQuery('\n   Error   TS2345:   type mismatch\nmore')).toBe('Error TS2345: type mismatch');
  });

  it('cuts long lines at a word boundary', () => {
    const query = condenseOcrQuery('alpha beta gamma delta epsilon zeta eta theta iota kappa', 20);
    expect(query.length).toBeLessThanOrEqual(20);
    expect(query.endsWith(' ')).toBe(false);
  });

  it('returns an empty string when there is no text', () => {
    expect(condenseOcrQuery('   \n\n ')).toBe('');
  });
});
