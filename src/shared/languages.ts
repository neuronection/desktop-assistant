import catalogData from './catalogs/languages.json';

export interface LanguageEntry {
  /** ISO-639-1 code, lowercase. */
  code: string;
  /** English name. */
  name: string;
  nativeName: string;
}

interface CatalogEntry {
  code: string;
  name: string;
  nativeName: string;
  /** Decorative only; the desktop app does not render catalog flags. */
  flag?: string;
}

/**
 * Shared family language catalog (ADR-0024), vendored verbatim from
 * templates/data/catalogs/languages.json. Vendored — not imported from
 * `@neuronection/assistant-ui/languages` — because that package exports
 * ESM-only and the CommonJS main process cannot `require()` it. Keep this
 * copy in sync with the catalog source.
 */
const CATALOG: readonly CatalogEntry[] = catalogData.languages;

export const LANGUAGES: LanguageEntry[] = CATALOG.map(({ code, name, nativeName }) => ({ code, name, nativeName }));

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

/** Catalog entries for `codes`, in input order; unknown codes are skipped. */
export function pickLanguages(codes: readonly string[]): LanguageEntry[] {
  const picked: LanguageEntry[] = [];
  for (const code of codes) {
    const entry = findLanguage(code);
    if (entry) {
      picked.push(entry);
    } else {
      console.warn(`[languages] pickLanguages: unknown language code ${code}`);
    }
  }
  return picked;
}
