import { describe, it, expect } from 'vitest';
import { LANGUAGES, findLanguage, isLanguageCode } from '@shared/languages';

describe('language table', () => {
  it('contains unique lowercase ISO-639-1 codes with non-empty names', () => {
    const codes = LANGUAGES.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const entry of LANGUAGES) {
      expect(entry.code).toMatch(/^[a-z]{2}$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.nativeName.length).toBeGreaterThan(0);
    }
  });

  it('includes the core set (Greek, English, German, Japanese)', () => {
    for (const code of ['el', 'en', 'de', 'ja']) {
      expect(findLanguage(code)).not.toBeNull();
    }
  });

  it('looks up case-insensitively and trims input', () => {
    expect(findLanguage(' EL ')?.name).toBe('Greek');
    expect(findLanguage('En')?.code).toBe('en');
  });

  it('returns null for unknown codes', () => {
    expect(findLanguage('xx')).toBeNull();
    expect(findLanguage('greek')).toBeNull();
    expect(findLanguage('')).toBeNull();
  });

  it('guards with isLanguageCode', () => {
    expect(isLanguageCode('el')).toBe(true);
    expect(isLanguageCode('EL')).toBe(true);
    expect(isLanguageCode('zz')).toBe(false);
    expect(isLanguageCode(42)).toBe(false);
    expect(isLanguageCode(null)).toBe(false);
  });
});
