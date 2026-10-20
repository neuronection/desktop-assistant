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
import { isTimeoutSafePattern } from './safePattern';

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

function patternProblems(node: unknown, path: string): string[] {
  if (!isRecord(node)) {
    return [];
  }
  const properties = node.properties;
  if (!isRecord(properties)) {
    return [];
  }
  const problems: string[] = [];
  for (const [name, field] of Object.entries(properties)) {
    if (!isRecord(field)) {
      continue;
    }
    const pattern = field.pattern;
    if (typeof pattern !== 'string') {
      continue;
    }
    const verdict = isTimeoutSafePattern(pattern);
    if (!verdict.ok) {
      problems.push(`${path}.${name}.pattern: ${verdict.reason}`);
    }
  }
  return problems;
}

/**
 * Tier derivation (plan 38 W3 — the TS mirror of
 * `contract.derive_tier`, pinned by the fixture wall): `entry` is the
 * code declaration (imported ⇒ T2, bundled ⇒ T1), `mcp` declares the
 * external MCP process (⇒ T3), and no `entry` ⇒ T0. Never a manifest
 * claim — the caller derives, exactly like the Python hosts.
 */
export function tierForManifest(
  manifest: unknown,
  options: { bundled?: boolean } = {},
): 'T0' | 'T1' | 'T2' | 'T3' | null {
  if (!isRecord(manifest)) {
    return null;
  }
  if (options.bundled) {
    return 'T1';
  }
  if (typeof manifest.entry !== 'string') {
    return 'T0';
  }
  return isRecord(manifest.mcp) ? 'T3' : 'T2';
}

/**
 * The caller-claim cross-check (plan 38 W3): a declared tier that
 * contradicts the provenance derivation is a registration problem — no host
 * may re-tier code-carrying content as declarative T0.
 */
export function tierProblems(
  manifest: unknown,
  declared: string,
  options: { bundled?: boolean } = {},
): string[] {
  const derived = tierForManifest(manifest, options);
  if (derived === null) {
    return ['manifest is not an object'];
  }
  return derived === declared
    ? []
    : [
        `$.entry: provenance derives tier ${derived} from the entry path, but the caller claims tier ` +
          `${JSON.stringify(declared)} — tier is provenance, never caller-claimed`,
      ];
}

/**
 * The envelope registration checks the schema cannot express: i18n
 * semantics, the timeout-safe pattern policy, and the two structural
 * bans a host may not leave to the profile (fs-write-mutate reserved,
 * ui:custom-code imported-only). The Python twin is
 * `contract.validate_registration`; the fixture wall pins both.
 */
export function envelopeRegistrationProblems(manifest: unknown): string[] {
  if (!isRecord(manifest)) {
    return ['manifest is not an object'];
  }
  const problems = manifestI18nSemantics(manifest);
  const capabilities = new Set(
    Array.isArray(manifest.capabilities) ? manifest.capabilities.filter((c): c is string => typeof c === 'string') : [],
  );
  if (capabilities.has('fs-write-mutate')) {
    problems.push(
      '$.capabilities: fs-write-mutate is reserved for refinement >= 2 and is rejected in v1',
    );
  }
  if (capabilities.has('ui:custom-code')) {
    problems.push(
      '$.capabilities: ui:custom-code is bundled-only; an imported manifest can never declare it',
    );
  }
  problems.push(...patternProblems(manifest.configSchema, '$.configSchema'));
  problems.push(...patternProblems(manifest.itemSchema, '$.itemSchema'));
  return problems;
}
