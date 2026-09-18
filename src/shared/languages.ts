export interface LanguageEntry {
  /** ISO-639-1 code, lowercase. */
  code: string;
  /** English name. */
  name: string;
  nativeName: string;
}

export const LANGUAGES: LanguageEntry[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'zh', name: 'Chinese', nativeName: '中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

const LANGUAGE_INDEX = new Map(LANGUAGES.map((entry) => [entry.code, entry]));

export function findLanguage(code: string): LanguageEntry | null {
  return LANGUAGE_INDEX.get(code.trim().toLowerCase()) ?? null;
}

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && LANGUAGE_INDEX.has(value.trim().toLowerCase());
}

export interface CustomLanguageEntry {
  /** 2-12 chars, `[a-z0-9-]`, not colliding with a built-in code. */
  code: string;
  name: string;
  nativeName?: string;
}

export const CUSTOM_LANGUAGE_CODE_PATTERN = /^[a-z][a-z0-9-]{1,11}$/;

export function normalizeCustomLanguageCode(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  return CUSTOM_LANGUAGE_CODE_PATTERN.test(code) && !LANGUAGE_INDEX.has(code) ? code : null;
}

/** Built-ins first, then the user's custom list (merge guarantees no overlap). */
export function resolveLanguage(code: string, custom: CustomLanguageEntry[] = []): LanguageEntry | null {
  const builtin = findLanguage(code);
  if (builtin) {
    return builtin;
  }
  const needle = code.trim().toLowerCase();
  const entry = custom.find((candidate) => candidate.code === needle);
  return entry ? { code: entry.code, name: entry.name, nativeName: entry.nativeName ?? entry.name } : null;
}
