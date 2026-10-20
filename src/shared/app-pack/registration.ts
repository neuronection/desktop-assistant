/**
 * Registration-time semantics beyond JSON Schema (plan 35 wave B /
 * plan 37 Phase 0). The Python canonical lives in
 * `contracts/contract.py` (`manifest_i18n_semantics`); this is the
 * byte-pinned cross-language mirror the fixture wall exercises.
 *
 * A manifest passing the schema is not valid: the default-locale title
 * requirement and the declared title/summary caps are cross-key rules the
 * schema cannot express. Hosts must run this (or the vendored Python
 * function) at registration — never mid-run.
 */
import { EXTENSION_CHARTER } from './extension.generated';

const LIMITS = EXTENSION_CHARTER.limits as {
  titleMaxChars?: number;
  summaryMaxChars?: number;
};

export const I18N_TITLE_MAX_CHARS = LIMITS.titleMaxChars ?? 80;
export const I18N_SUMMARY_MAX_CHARS = LIMITS.summaryMaxChars ?? 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return every i18n problem (empty = clean), exactly like the Python twin. */
export function manifestI18nSemantics(manifest: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(manifest)) {
    return ['manifest is not an object'];
  }
  const i18n = manifest.i18n;
  if (!isRecord(i18n)) {
    return ['i18n is not an object (the schema rejects it before semantics)'];
  }
  const defaultLocale = i18n.defaultLocale;
  const locales = i18n.locales;
  if (typeof defaultLocale !== 'string' || !isRecord(locales)) {
    return ['i18n.defaultLocale/locales malformed (the schema rejects it before semantics)'];
  }
  const defaultEntry = locales[defaultLocale];
  if (!isRecord(defaultEntry)) {
    return [`i18n.locales carries no entry for the default locale ${JSON.stringify(defaultLocale)}`];
  }
  const title = defaultEntry.title;
  if (title === undefined) {
    problems.push(
      `i18n.locales[${JSON.stringify(defaultLocale)}]: missing 'title' — the default-locale ` +
        'title is REQUIRED (cards render it verbatim; there is no honest id fallback)',
    );
  } else if (typeof title !== 'string') {
    problems.push(`i18n.locales[${JSON.stringify(defaultLocale)}].title: not a string`);
  } else if (title.length < 1 || title.length > I18N_TITLE_MAX_CHARS) {
    problems.push(
      `i18n.locales[${JSON.stringify(defaultLocale)}].title: length ${title.length} outside ` +
        `1..${I18N_TITLE_MAX_CHARS}`,
    );
  }
  for (const [locale, entry] of Object.entries(locales)) {
    if (!isRecord(entry)) {
      continue;
    }
    const localeTitle = entry.title;
    if (typeof localeTitle === 'string' && (localeTitle.length < 1 || localeTitle.length > I18N_TITLE_MAX_CHARS)) {
      problems.push(
        `i18n.locales[${JSON.stringify(locale)}].title: length ${localeTitle.length} outside ` +
          `1..${I18N_TITLE_MAX_CHARS}`,
      );
    }
    const localeSummary = entry.summary;
    if (typeof localeSummary === 'string' && localeSummary.length > I18N_SUMMARY_MAX_CHARS) {
      problems.push(
        `i18n.locales[${JSON.stringify(locale)}].summary: length ${localeSummary.length} ` +
          `> ${I18N_SUMMARY_MAX_CHARS}`,
      );
    }
  }
  return problems;
}
