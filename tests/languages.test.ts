import { describe, it, expect } from 'vitest';
import { LANGUAGES, findLanguage, isLanguageCode, normalizeCustomLanguageCode, resolveLanguage } from '@shared/languages';
import { DEFAULT_CONFIG, mergeWithDefaults } from '@shared/config/AppConfig';
import { clampPadDebounce } from '@shared/translation';
import type { CustomLanguageEntry } from '@shared/languages';

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

describe('custom language codes', () => {
  it('normalizes codes: lowercase, 2-12 chars, no built-in collision', () => {
    expect(normalizeCustomLanguageCode(' GRC ')).toBe('grc');
    expect(normalizeCustomLanguageCode('zh-Hant')).toBe('zh-hant');
    expect(normalizeCustomLanguageCode('el')).toBeNull();
    expect(normalizeCustomLanguageCode('1abc')).toBeNull();
    expect(normalizeCustomLanguageCode('a')).toBeNull();
    expect(normalizeCustomLanguageCode('way-too-long-code')).toBeNull();
    expect(normalizeCustomLanguageCode('has_underscore')).toBeNull();
  });

  it('resolves built-ins first, then custom entries, with nativeName fallback', () => {
    const custom: CustomLanguageEntry[] = [{ code: 'grc', name: 'Ancient Greek', nativeName: 'Ἑλληνική' }, { code: 'tok', name: 'Toki Pona' }];
    expect(resolveLanguage('el', custom)?.name).toBe('Greek');
    expect(resolveLanguage('GRC', custom)).toEqual({ code: 'grc', name: 'Ancient Greek', nativeName: 'Ἑλληνική' });
    expect(resolveLanguage('tok', custom)).toEqual({ code: 'tok', name: 'Toki Pona', nativeName: 'Toki Pona' });
    expect(resolveLanguage('zz', custom)).toBeNull();
  });
});

describe('mergeWithDefaults custom-language migration', () => {
  it('keeps valid entries, lowercases codes, trims names', () => {
    const merged = mergeWithDefaults({
      translation: { customLanguages: [{ code: 'GRC', name: '  Ancient Greek  ', nativeName: ' Ἑλληνική ' }] },
    } as never).translation;
    expect(merged.customLanguages).toEqual([{ code: 'grc', name: 'Ancient Greek', nativeName: 'Ἑλληνική' }]);
  });

  it('drops built-in collisions, invalid codes and duplicates (first wins)', () => {
    const merged = mergeWithDefaults({
      translation: {
        customLanguages: [
          { code: 'EL', name: 'Fake Greek' },
          { code: 'grc', name: 'Ancient Greek' },
          { code: 'GRC', name: 'Duplicate' },
          { code: '1bad', name: 'Nope' },
          { code: 'ok2', name: '' },
        ],
      },
    } as never).translation;
    expect(merged.customLanguages).toEqual([{ code: 'grc', name: 'Ancient Greek' }]);
  });

  it('validates the default target against built-ins and custom languages', () => {
    const withCustom = mergeWithDefaults({
      translation: { defaultTarget: 'GRC', customLanguages: [{ code: 'grc', name: 'Ancient Greek' }] },
    } as never).translation;
    expect(withCustom.defaultTarget).toBe('grc');
    const withoutCustom = mergeWithDefaults({
      translation: { defaultTarget: 'grc' },
    } as never).translation;
    expect(withoutCustom.defaultTarget).toBeNull();
    expect(mergeWithDefaults({}).translation.customLanguages).toEqual([]);
    expect(DEFAULT_CONFIG.translation.customLanguages).toEqual([]);
  });

  it('clamps the pad debounce to the conservative window', () => {
    expect(DEFAULT_CONFIG.translation.padDebounceMs).toBe(1500);
    expect(clampPadDebounce(undefined)).toBe(1500);
    expect(clampPadDebounce('not-a-number')).toBe(1500);
    expect(clampPadDebounce(50)).toBe(300);
    expect(clampPadDebounce(60000)).toBe(10000);
    expect(clampPadDebounce(2000.6)).toBe(2001);
    const merged = mergeWithDefaults({ translation: { padDebounceMs: 999999 } } as never).translation;
    expect(merged.padDebounceMs).toBe(10000);
  });
});
