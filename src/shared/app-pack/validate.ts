import {
  PACK_API_VERSION,
  PACK_DEPRECATION_WINDOW_MAJORS,
  PACK_CAPABILITIES,
  PACK_CAPABILITY_TIERS,
  PACK_SLOTS,
  PACK_KINDS,
  PACK_PROPOSE_VERBS,
  PACK_QUESTION_TYPES,
  PACK_REPORT_COMPONENTS,
  PACK_LIVE_CARD_COMPONENTS,
  PACK_LIVE_CARD_BINDS,
  PACK_RUN_ACTIONS,
  PACK_ITEM_ACTIONS,
  PACK_LEAF_OPS,
  PACK_ID_PATTERN,
  PACK_VERSION_PATTERN,
  PACK_RESERVED_ID_PREFIXES,
  PACK_CATEGORIES,
  PACK_DOCS_POINTER,
  PACK_REPOSITORY_PATTERN,
  PACK_LIMITS,
} from './contract.generated';
import { isTimeoutSafePattern } from './safePattern';
import type {
  PackConfigField,
  PackManifest,
  PackQuestionType,
  PackValidationCode,
  PackValidationIssue,
  PackValidationResult,
  ValidatedPack,
} from './types';

export interface ValidatePackOptions {
  /** Bundled (Tier 1) packs may carry `ui` capabilities, contributions and code. */
  bundled?: boolean;
  /**
   * Imported code pack under the Tier-2 sandbox (ADR-0030): `code`,
   * `contributions` and the sandbox capability set unlock; the pack must
   * be a surface pack. Tier is provenance at install time — the caller
   * (registry/sources pipeline) derives this, never the manifest.
   */
  sandboxed?: boolean;
}

/**
 * The sandbox capability set (ADR-0030 v1): charter capabilities whose
 * tiers include 2 that this host honors for imported code packs. `net`
 * is excluded — the exfiltration class is denied for code packs
 * (ADR-0029 clause 6, ADR-0030 clauses 4/6); the charter-drift test pins
 * every entry against the vendored charter tier table.
 */
export const SANDBOX_CAPABILITIES: readonly string[] = ['state', 'secrets', 'ui:chat-card', 'ui:settings'];

const SANDBOX_SLOT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CHAT_SLOTS: readonly string[] = ['commands', 'input-mode', 'composer-toolbar', 'panel-header', 'card-actions', 'result-actions', 'status'];
const PATTERN_SUBJECT_MAX_CHARS = 256;

const ID_RE = new RegExp(PACK_ID_PATTERN);
const VERSION_RE = new RegExp(PACK_VERSION_PATTERN);
const REPOSITORY_RE = new RegExp(PACK_REPOSITORY_PATTERN);
const RULE_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const NODE_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const QUESTION_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
const I18N_KEY_RE = /^[a-zA-Z][a-zA-Z0-9.*_-]{0,95}$/;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
const SIGNAL_META = new Set(['meta.size', 'meta.ageDays', 'meta.ext', 'meta.name', 'meta.path']);
const MAX_CONDITION_DEPTH = 8;

class Collector {
  readonly issues: PackValidationIssue[] = [];

  add(path: string, code: PackValidationCode, message: string): void {
    this.issues.push({ path, code, message });
  }

  get failed(): boolean {
    return this.issues.length > 0;
  }
}

type ConfigFieldType = 'string' | 'number' | 'boolean' | 'array';

interface SignalContext {
  rules: Set<string>;
  config: Map<string, ConfigFieldType>;
  questions: Map<string, PackQuestionType>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Envelope-shared optional metadata (D25 / plan 34 §10.3, adopted into
 * the mini-app kind 2026-10-19): shapes mirror extension-manifest.schema.json
 * field-for-field — provenance renders verbatim, categories come from the
 * closed charter vocabulary, docs is the one fixed pointer. Presence is
 * never required; a present-but-malformed field self-disables.
 */
function checkEnvelopeSharedFields(base: Record<string, unknown>, c: Collector): void {
  for (const [field, max] of [['author', 120], ['license', 120]] as const) {
    const value = base[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || value.length === 0 || value.length > max) {
      c.add(`$.${field}`, 'malformed', `${field} must be a non-empty string (≤ ${max} chars).`);
    }
  }
  const repository = base.repository;
  if (repository !== undefined) {
    if (typeof repository !== 'string' || repository.length === 0 || repository.length > 512) {
      c.add('$.repository', 'malformed', 'repository must be an https git URL string (≤ 512 chars).');
    } else if (!REPOSITORY_RE.test(repository)) {
      c.add('$.repository', 'malformed', 'repository must be an https-only git URL (no userinfo, no whitespace) — the family distribution surface.');
    }
  }
  const categories = base.categories;
  if (categories !== undefined) {
    if (!Array.isArray(categories) || categories.length === 0) {
      c.add('$.categories', 'malformed', 'categories must be a non-empty array from the closed vocabulary.');
    } else {
      if (categories.length > 3) {
        c.add('$.categories', 'limits', `Too many categories (${categories.length} > 3).`);
      }
      const seen = new Set<string>();
      for (const category of categories) {
        if (typeof category !== 'string' || !(PACK_CATEGORIES as readonly string[]).includes(category)) {
          c.add('$.categories', 'malformed', `Unknown category "${String(category)}" (closed vocabulary: ${PACK_CATEGORIES.join(', ')}).`);
        } else if (seen.has(category)) {
          c.add('$.categories', 'malformed', `Duplicate category "${category}".`);
        }
        seen.add(String(category));
      }
    }
  }
  const docs = base.docs;
  if (docs !== undefined && docs !== PACK_DOCS_POINTER) {
    c.add('$.docs', 'malformed', `docs must be the fixed pointer "${PACK_DOCS_POINTER}" (got ${JSON.stringify(docs)}).`);
  }
}

function expectKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string, c: Collector, code: PackValidationCode): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      c.add(`${path}.${key}`, code, `Unknown field "${key}" (allowed: ${allowed.join(', ')}).`);
    }
  }
}

function checkGlobList(value: unknown, path: string, c: Collector, cap: number): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    c.add(path, 'malformed', 'Expected an array of glob strings.');
    return [];
  }
  if (value.length > cap) {
    c.add(path, 'limits', `Too many entries (${value.length} > ${cap}).`);
  }
  const out: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 256 || entry.includes('\0')) {
      c.add(`${path}[${index}]`, 'malformed', 'Globs must be non-empty strings (≤ 256 chars).');
      return;
    }
    out.push(entry);
  });
  return out;
}

function checkCondition(
  condition: unknown,
  path: string,
  c: Collector,
  signals: SignalContext,
  depth = 0
): void {
  if (depth > MAX_CONDITION_DEPTH) {
    c.add(path, 'limits', `Condition nesting deeper than ${MAX_CONDITION_DEPTH}.`);
    return;
  }
  if (!isRecord(condition)) {
    c.add(path, 'malformed', 'Expected a condition object.');
    return;
  }
  if (Array.isArray((condition as { all?: unknown }).all)) {
    expectKeys(condition, ['all'], path, c, 'pipeline');
    walkList(condition.all, `${path}.all`, c, signals, depth);
    return;
  }
  if (Array.isArray((condition as { any?: unknown }).any)) {
    expectKeys(condition, ['any'], path, c, 'pipeline');
    walkList(condition.any, `${path}.any`, c, signals, depth);
    return;
  }
  if (isRecord((condition as { not?: unknown }).not)) {
    expectKeys(condition, ['not'], path, c, 'pipeline');
    checkCondition(condition.not, `${path}.not`, c, signals, depth + 1);
    return;
  }
  expectKeys(condition, ['signal', 'op', 'value', 'valueSignal'], path, c, 'pipeline');
  const { signal, op, value, valueSignal } = condition as Record<string, unknown>;
  if (typeof signal !== 'string') {
    c.add(`${path}.signal`, 'malformed', 'Signal must be a string.');
    return;
  }
  if (typeof op !== 'string' || !(PACK_LEAF_OPS as readonly string[]).includes(op)) {
    c.add(`${path}.op`, 'pipeline', `Unknown operator (allowed: ${PACK_LEAF_OPS.join(', ')}).`);
    return;
  }
  checkSignalPath(signal, `${path}.signal`, c, signals, op);
  const hasValue = 'value' in condition;
  const hasValueSignal = 'valueSignal' in condition;
  if (op === 'exists') {
    if (hasValue || hasValueSignal) {
      c.add(path, 'pipeline', "'exists' takes neither value nor valueSignal.");
    }
    return;
  }
  if (hasValue === hasValueSignal) {
    c.add(path, 'pipeline', 'Exactly one of value/valueSignal is required for this operator.');
    return;
  }
  if (hasValueSignal) {
    if (typeof valueSignal !== 'string') {
      c.add(`${path}.valueSignal`, 'malformed', 'valueSignal must be a signal path string.');
      return;
    }
    checkSignalPath(valueSignal, `${path}.valueSignal`, c, signals, op);
    return;
  }
  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string' || typeof v === 'number')) {
      c.add(`${path}.value`, 'malformed', "'in' expects a non-empty array of strings/numbers.");
    }
  } else if (op === 'matches') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
      c.add(`${path}.value`, 'malformed', "'matches' expects a glob string.");
    }
  } else if (op === 'matches-any') {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string' && v.length > 0)) {
      c.add(`${path}.value`, 'malformed', "'matches-any' expects a non-empty glob array (literal, or via valueSignal).");
    }
  } else if (op === 'eq' || op === 'ne') {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      c.add(`${path}.value`, 'malformed', 'Expected a string, number or boolean literal.');
    }
  } else if (typeof value !== 'string' && typeof value !== 'number') {
    c.add(`${path}.value`, 'malformed', 'Expected a string or number literal.');
  }
}

function walkList(
  entries: unknown,
  path: string,
  c: Collector,
  signals: SignalContext,
  depth: number
): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    c.add(path, 'malformed', 'Expected a non-empty condition array.');
    return;
  }
  entries.forEach((entry, index) => checkCondition(entry, `${path}[${index}]`, c, signals, depth + 1));
}

function checkSignalPath(
  signal: string,
  path: string,
  c: Collector,
  signals: SignalContext,
  op?: string
): void {
  if (SIGNAL_META.has(signal)) {
    return;
  }
  if (signal.startsWith('rule.')) {
    const id = signal.slice(5);
    if (!signals.rules.has(id)) {
      c.add(path, 'cross-reference', `Signal references undeclared rule "${id}".`);
    }
    return;
  }
  if (signal.startsWith('config.')) {
    const key = signal.slice(7);
    const type = signals.config.get(key);
    if (!type) {
      c.add(path, 'cross-reference', `Signal references undeclared config key "${key}".`);
    } else if ((op === 'in' || op === 'matches-any') && type !== 'array') {
      c.add(path, 'pipeline', `'${op}' with valueSignal requires an array config key (config.${key} is ${type}).`);
    }
    return;
  }
  if (signal.startsWith('answer.')) {
    const rest = signal.slice(7);
    const dot = rest.indexOf('.');
    if (dot <= 0) {
      c.add(path, 'pipeline', 'Answer signals must be answer.<questionId>.value|confidence|choice.');
      return;
    }
    const id = rest.slice(0, dot);
    const part = rest.slice(dot + 1);
    const type = signals.questions.get(id);
    if (!type) {
      c.add(path, 'cross-reference', `Signal references undeclared question "${id}".`);
      return;
    }
    if (part === 'confidence') {
      return;
    }
    if (part === 'choice') {
      if (type !== 'choice') {
        c.add(path, 'pipeline', `answer.<id>.choice requires a choice question (got ${type}).`);
      }
      return;
    }
    if (part === 'value') {
      if (type === 'choice') {
        c.add(path, 'pipeline', 'choice questions expose .choice, not .value.');
      }
      return;
    }
    c.add(path, 'pipeline', 'Answer signals end in .value, .confidence or .choice.');
    return;
  }
  c.add(path, 'pipeline', `Unknown signal "${signal}" (allowed: meta.*, rule.<id>, config.<key>, answer.<id>.*).`);
}

function checkQuestions(
  value: unknown,
  path: string,
  c: Collector
): Map<string, PackQuestionType> {
  const questions = new Map<string, PackQuestionType>();
  if (!Array.isArray(value) || value.length === 0) {
    c.add(path, 'pipeline', 'decide.questions must be a non-empty array.');
    return questions;
  }
  if (value.length > PACK_LIMITS.questionsPerPackMax) {
    c.add(path, 'limits', `Too many questions (${value.length} > ${PACK_LIMITS.questionsPerPackMax}).`);
  }
  value.forEach((raw, index) => {
    const qPath = `${path}[${index}]`;
    if (!isRecord(raw)) {
      c.add(qPath, 'malformed', 'Expected a question object.');
      return;
    }
    const { id, type, instructions, criteria, options, levels } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !QUESTION_ID_RE.test(id)) {
      c.add(`${qPath}.id`, 'malformed', 'Question ids are lowercase alphanumeric/underscore (≤ 40 chars).');
      return;
    }
    if (questions.has(id)) {
      c.add(`${qPath}.id`, 'cross-reference', `Duplicate question id "${id}".`);
      return;
    }
    if (typeof type !== 'string' || !(PACK_QUESTION_TYPES as readonly string[]).includes(type)) {
      c.add(`${qPath}.type`, 'pipeline', `Unknown question type (allowed: ${PACK_QUESTION_TYPES.join(', ')}).`);
      return;
    }
    if (typeof instructions !== 'string' || instructions.length === 0 || instructions.length > 2000) {
      c.add(`${qPath}.instructions`, 'malformed', 'Instructions must be a non-empty string (≤ 2000 chars).');
      return;
    }
    if (type === 'noul') {
      expectKeys(raw, ['id', 'type', 'instructions', 'criteria'], qPath, c, 'pipeline');
      if (criteria !== undefined && !isRecord(criteria)) {
        c.add(`${qPath}.criteria`, 'malformed', 'criteria must be { true, false }.');
      }
    } else if (type === 'choice') {
      expectKeys(raw, ['id', 'type', 'instructions', 'options'], qPath, c, 'pipeline');
      if (!isRecord(options) || Object.keys(options).length === 0 || Object.keys(options).length > 16) {
        c.add(`${qPath}.options`, 'malformed', 'choice options must be a map of 1–16 entries.');
      }
    } else {
      expectKeys(raw, ['id', 'type', 'instructions', 'levels'], qPath, c, 'pipeline');
      if (
        !Array.isArray(levels) ||
        levels.length === 0 ||
        levels.length > 10 ||
        !levels.every((l) => typeof l === 'string' && l.length > 0 && l.length <= 80)
      ) {
        c.add(`${qPath}.levels`, 'malformed', 'score levels must be 1–10 non-empty strings (≤ 80 chars).');
      }
    }
    questions.set(id, type as PackQuestionType);
  });
  return questions;
}

function checkConfigSchema(value: unknown, path: string, c: Collector): Map<string, 'string' | 'number' | 'boolean' | 'array'> {
  const keys = new Map<string, 'string' | 'number' | 'boolean' | 'array'>();
  if (value === undefined || value === null) {
    return keys;
  }
  if (!isRecord(value)) {
    c.add(path, 'config-schema', 'Expected a config schema object.');
    return keys;
  }
  expectKeys(value, ['type', 'properties', 'additionalProperties'], path, c, 'config-schema');
  if (value.type !== 'object') {
    c.add(`${path}.type`, 'config-schema', "Config schemas must have type 'object'.");
    return keys;
  }
  if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
    c.add(`${path}.additionalProperties`, 'config-schema', 'additionalProperties must be false when present.');
  }
  if (!isRecord(value.properties)) {
    c.add(`${path}.properties`, 'config-schema', 'properties must be an object.');
    return keys;
  }
  const propNames = Object.keys(value.properties);
  if (propNames.length > PACK_LIMITS.configPropertiesMax) {
    c.add(`${path}.properties`, 'limits', `Too many config properties (${propNames.length} > ${PACK_LIMITS.configPropertiesMax}).`);
  }
  for (const name of propNames) {
    const fPath = `${path}.properties.${name}`;
    const field = value.properties[name];
    if (!isRecord(field)) {
      c.add(fPath, 'config-schema', 'Expected a field definition.');
      continue;
    }
    checkConfigField(field, fPath, c);
    if (typeof field.type === 'string') {
      keys.set(name, field.type as 'string' | 'number' | 'boolean' | 'array');
    }
  }
  return keys;
}

function checkConfigField(field: Record<string, unknown>, path: string, c: Collector): void {
  const type = field.type;
  if (type === 'string') {
    expectKeys(field, ['type', 'enum', 'default', 'minLength', 'maxLength', 'pattern', 'title', 'description'], path, c, 'config-schema');
    if (field.enum !== undefined) {
      if (
        !Array.isArray(field.enum) ||
        field.enum.length === 0 ||
        !field.enum.every((v) => typeof v === 'string')
      ) {
        c.add(`${path}.enum`, 'config-schema', 'enum must be a non-empty string array.');
      }
    }
    if (field.default !== undefined && typeof field.default !== 'string') {
      c.add(`${path}.default`, 'config-schema', 'default must be a string.');
    }
    if (field.pattern !== undefined) {
      if (typeof field.pattern !== 'string' || field.pattern.length > 256) {
        c.add(`${path}.pattern`, 'config-schema', 'pattern must be a string (≤ 256 chars).');
      } else {
        try {
          new RegExp(field.pattern);
        } catch {
          c.add(`${path}.pattern`, 'config-schema', 'pattern is not a valid regular expression.');
        }
        const safety = isTimeoutSafePattern(field.pattern);
        if (!safety.ok) {
          c.add(`${path}.pattern`, 'config-schema', `pattern is not timeout-safe (${safety.reason}); re-author without nested or unbounded quantifiers.`);
        }
      }
    }
  } else if (type === 'number') {
    expectKeys(field, ['type', 'default', 'minimum', 'maximum', 'title', 'description'], path, c, 'config-schema');
    for (const key of ['default', 'minimum', 'maximum']) {
      if (field[key] !== undefined && typeof field[key] !== 'number') {
        c.add(`${path}.${key}`, 'config-schema', `${key} must be a number.`);
      }
    }
    if (typeof field.minimum === 'number' && typeof field.maximum === 'number' && field.minimum > field.maximum) {
      c.add(`${path}.maximum`, 'config-schema', 'maximum must be ≥ minimum.');
    }
  } else if (type === 'boolean') {
    expectKeys(field, ['type', 'default', 'title', 'description'], path, c, 'config-schema');
    if (field.default !== undefined && typeof field.default !== 'boolean') {
      c.add(`${path}.default`, 'config-schema', 'default must be a boolean.');
    }
  } else if (type === 'array') {
    expectKeys(field, ['type', 'items', 'default', 'minItems', 'maxItems', 'title', 'description'], path, c, 'config-schema');
    if (!isRecord(field.items) || field.items.type !== 'string') {
      c.add(`${path}.items`, 'config-schema', "array items must be { type: 'string' }.");
    }
    if (field.default !== undefined) {
      if (!Array.isArray(field.default) || !field.default.every((v) => typeof v === 'string')) {
        c.add(`${path}.default`, 'config-schema', 'default must be a string array.');
      }
    }
  } else {
    c.add(`${path}.type`, 'config-schema', "Unknown field type (allowed: string, number, boolean, array).");
    return;
  }
  for (const key of ['title', 'description']) {
    if (field[key] !== undefined && (typeof field[key] !== 'string' || (field[key] as string).length > 200)) {
      c.add(`${path}.${key}`, 'config-schema', `${key} must be an i18n key string (≤ 200 chars).`);
    }
  }
}

function checkI18n(value: unknown, path: string, c: Collector, requiredKeys: Set<string>): string {
  if (!isRecord(value)) {
    c.add(path, 'i18n', 'Expected an i18n object.');
    return '';
  }
  expectKeys(value, ['defaultLocale', 'locales'], path, c, 'i18n');
  const { defaultLocale, locales } = value as Record<string, unknown>;
  if (typeof defaultLocale !== 'string' || !LOCALE_RE.test(defaultLocale)) {
    c.add(`${path}.defaultLocale`, 'i18n', 'defaultLocale must be a BCP-47-ish locale tag.');
    return '';
  }
  if (!isRecord(locales) || Object.keys(locales).length === 0) {
    c.add(`${path}.locales`, 'i18n', 'locales must be a non-empty map.');
    return defaultLocale as string;
  }
  const localeNames = Object.keys(locales);
  if (localeNames.length > PACK_LIMITS.localesMax) {
    c.add(`${path}.locales`, 'limits', `Too many locales (${localeNames.length} > ${PACK_LIMITS.localesMax}).`);
  }
  if (!localeNames.includes(defaultLocale)) {
    c.add(`${path}.locales.${defaultLocale}`, 'i18n', 'defaultLocale must be present in locales.');
  }
  let reference: Set<string> | null = null;
  for (const locale of localeNames) {
    if (!LOCALE_RE.test(locale)) {
      c.add(`${path}.locales.${locale}`, 'i18n', 'Invalid locale tag.');
      continue;
    }
    const map = locales[locale];
    if (!isRecord(map)) {
      c.add(`${path}.locales.${locale}`, 'i18n', 'Locale map must be an object.');
      continue;
    }
    const keys = Object.keys(map);
    if (keys.length > PACK_LIMITS.i18nKeysPerLocaleMax) {
      c.add(`${path}.locales.${locale}`, 'limits', `Too many keys (${keys.length} > ${PACK_LIMITS.i18nKeysPerLocaleMax}).`);
    }
    for (const key of keys) {
      if (!I18N_KEY_RE.test(key)) {
        c.add(`${path}.locales.${locale}.${key}`, 'i18n', 'Invalid i18n key.');
      }
      const label = map[key];
      if (typeof label !== 'string' || label.length === 0 || label.length > PACK_LIMITS.i18nValueMaxChars) {
        c.add(`${path}.locales.${locale}.${key}`, 'i18n', `Label must be a non-empty string (≤ ${PACK_LIMITS.i18nValueMaxChars} chars).`);
      }
    }
    if (reference === null) {
      reference = new Set(keys);
    } else {
      for (const key of reference) {
        if (!(key in map)) {
          c.add(`${path}.locales.${locale}`, 'i18n', `Locale is missing key "${key}" (every locale carries the same key set).`);
        }
      }
      for (const key of keys) {
        if (!reference.has(key)) {
          c.add(`${path}.locales.${locale}.${key}`, 'i18n', `Key missing from other locales — every locale carries the same key set.`);
        }
      }
    }
  }
  const present = reference ?? new Set<string>();
  for (const key of requiredKeys) {
    if (!present.has(key)) {
      c.add(`${path}.locales.${defaultLocale}`, 'i18n', `Missing required key "${key}".`);
    }
  }
  return defaultLocale;
}

function checkReport(
  value: unknown,
  path: string,
  c: Collector,
  pack: { capabilities: Set<string>; hasPropose: boolean }
): void {
  if (!isRecord(value)) {
    c.add(path, 'report', 'Expected a report schema object.');
    return;
  }
  expectKeys(value, ['nodes'], path, c, 'report');
  const { nodes } = value as Record<string, unknown>;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    c.add(`${path}.nodes`, 'report', 'nodes must be a non-empty array.');
    return;
  }
  if (nodes.length > PACK_LIMITS.reportComponentsMax) {
    c.add(`${path}.nodes`, 'limits', `Too many components (${nodes.length} > ${PACK_LIMITS.reportComponentsMax}).`);
  }
  const ids = new Set<string>();
  let showsItems = false;
  let hasEvidence = false;
  for (const raw of nodes) {
    if (!isRecord(raw)) {
      c.add(`${path}.nodes`, 'report', 'Expected a component object.');
      continue;
    }
    const node = raw as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== 'string' || !(PACK_REPORT_COMPONENTS as readonly string[]).includes(type)) {
      c.add(`${path}.nodes`, 'report', `Unknown component type (allowed: ${PACK_REPORT_COMPONENTS.join(', ')}).`);
      continue;
    }
    const id = node.id;
    const nPath = `${path}.nodes[${typeof id === 'string' ? id : '?'}]`;
    if (typeof id !== 'string' || !NODE_ID_RE.test(id)) {
      c.add(`${nPath}.id`, 'malformed', 'Component ids are lowercase alphanumeric/dash (≤ 40 chars).');
      continue;
    }
    if (ids.has(id)) {
      c.add(`${nPath}.id`, 'cross-reference', `Duplicate component id "${id}".`);
      continue;
    }
    ids.add(id);
    if (type === 'stat' || type === 'badge' || type === 'progress' || type === 'select') {
      expectKeys(node, ['id', 'type', 'bind', ...(type === 'select' ? ['options'] : [])], nPath, c, 'report');
      if (typeof node.bind !== 'string' || node.bind.length === 0) {
        c.add(`${nPath}.bind`, 'report', 'bind must be a data key string.');
      }
      if (type === 'select' && (!Array.isArray(node.options) || node.options.length === 0)) {
        c.add(`${nPath}.options`, 'report', 'select requires non-empty options.');
      }
    } else if (type === 'table') {
      expectKeys(node, ['id', 'type', 'columns'], nPath, c, 'report');
      if (!Array.isArray(node.columns) || node.columns.length === 0 || !node.columns.every((k) => typeof k === 'string' && k.length > 0)) {
        c.add(`${nPath}.columns`, 'report', 'table requires non-empty string columns.');
      }
      showsItems = true;
    } else if (type === 'cards') {
      expectKeys(node, ['id', 'type', 'of'], nPath, c, 'report');
      if (node.of !== 'items' && node.of !== 'groups') {
        c.add(`${nPath}.of`, 'report', "cards.of must be 'items' or 'groups'.");
      }
      showsItems = true;
    } else if (type === 'filter-bar') {
      expectKeys(node, ['id', 'type', 'filters'], nPath, c, 'report');
      if (!Array.isArray(node.filters) || node.filters.length === 0) {
        c.add(`${nPath}.filters`, 'report', 'filter-bar requires non-empty filters.');
      }
    } else if (type === 'actions') {
      expectKeys(node, ['id', 'type', 'actions'], nPath, c, 'report');
      const closed = [...PACK_RUN_ACTIONS, ...PACK_ITEM_ACTIONS];
      if (!Array.isArray(node.actions) || node.actions.length === 0) {
        c.add(`${nPath}.actions`, 'report', 'actions requires a non-empty typed action list.');
      } else {
        for (const action of node.actions) {
          if (!(closed as string[]).includes(action as string)) {
            c.add(`${nPath}.actions`, 'report', `Unknown action "${String(action)}" (closed vocabulary).`);
            continue;
          }
          if (action === 'run:arm' && !pack.hasPropose) {
            c.add(`${nPath}.actions`, 'cross-reference', 'run:arm requires a propose step.');
          }
          if (
            (action === 'run:arm' || action === 'item:restore') &&
            !pack.capabilities.has('fs-write-quarantine')
          ) {
            c.add(`${nPath}.actions`, 'cross-reference', `${action} requires the fs-write-quarantine capability.`);
          }
          if ((action === 'item:reveal' || action === 'item:open') && !pack.capabilities.has('fs-read')) {
            c.add(`${nPath}.actions`, 'cross-reference', `${action} requires the fs-read capability.`);
          }
        }
      }
    } else if (type === 'evidence') {
      expectKeys(node, ['id', 'type'], nPath, c, 'report');
      hasEvidence = true;
    }
  }
  if (showsItems && !hasEvidence) {
    c.add(`${path}.nodes`, 'report', 'A table/cards component renders recommendations — an evidence component is mandatory.');
  }
}

function checkLiveCard(value: unknown, path: string, c: Collector): void {
  if (!isRecord(value)) {
    c.add(path, 'liveCard', 'Expected a live card schema object.');
    return;
  }
  expectKeys(value, ['nodes'], path, c, 'liveCard');
  const { nodes } = value as Record<string, unknown>;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    c.add(`${path}.nodes`, 'liveCard', 'nodes must be a non-empty array.');
    return;
  }
  if (nodes.length > PACK_LIMITS.liveCardComponentsMax) {
    c.add(`${path}.nodes`, 'limits', `Too many components (${nodes.length} > ${PACK_LIMITS.liveCardComponentsMax}).`);
  }
  const ids = new Set<string>();
  for (const raw of nodes) {
    if (!isRecord(raw)) {
      c.add(`${path}.nodes`, 'liveCard', 'Expected a component object.');
      continue;
    }
    const node = raw as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== 'string' || !(PACK_LIVE_CARD_COMPONENTS as readonly string[]).includes(type)) {
      c.add(`${path}.nodes`, 'liveCard', `Unknown component type (allowed: ${PACK_LIVE_CARD_COMPONENTS.join(', ')}).`);
      continue;
    }
    const id = node.id;
    const nPath = `${path}.nodes[${typeof id === 'string' ? id : '?'}]`;
    if (typeof id !== 'string' || !NODE_ID_RE.test(id)) {
      c.add(`${nPath}.id`, 'malformed', 'Component ids are lowercase alphanumeric/dash (≤ 40 chars).');
      continue;
    }
    if (ids.has(id)) {
      c.add(`${nPath}.id`, 'cross-reference', `Duplicate component id "${id}".`);
      continue;
    }
    ids.add(id);
    expectKeys(node, ['id', 'type', 'bind'], nPath, c, 'liveCard');
    if (typeof node.bind !== 'string' || !(PACK_LIVE_CARD_BINDS as readonly string[]).includes(node.bind)) {
      c.add(`${nPath}.bind`, 'liveCard', `Unknown bind "${String(node.bind)}" (allowed: ${PACK_LIVE_CARD_BINDS.join(', ')}).`);
      continue;
    }
    if (type === 'badge' && node.bind !== 'run.status') {
      c.add(`${nPath}.bind`, 'liveCard', 'badge binds run.status — the live card has one status surface.');
    }
    if (type === 'stat' && node.bind === 'progress') {
      c.add(`${nPath}.bind`, 'liveCard', 'stat binds a numeric run/totals path — progress belongs to the progress component.');
    }
    if (type === 'progress' && node.bind !== 'progress') {
      c.add(`${nPath}.bind`, 'liveCard', 'progress binds progress.');
    }
  }
}

function checkPipeline(
  value: unknown,
  path: string,
  c: Collector,
  pack: { capabilities: Set<string>; configKeys: Map<string, ConfigFieldType> }
): { questions: Map<string, PackQuestionType>; rules: Set<string>; hasPropose: boolean; requiredKeys: Set<string> } {
  const questions = new Map<string, PackQuestionType>();
  const rules = new Set<string>();
  const requiredKeys = new Set<string>();
  let hasPropose = false;
  if (!isRecord(value)) {
    c.add(path, 'pipeline', 'Assessment packs require a run pipeline object.');
    return { questions, rules, hasPropose, requiredKeys };
  }
  expectKeys(value, ['scan', 'classify', 'decide', 'compose', 'propose'], path, c, 'pipeline');
  const pipeline = value as Record<string, unknown>;

  if (!isRecord(pipeline.scan)) {
    c.add(`${path}.scan`, 'pipeline', 'scan step is required.');
  } else {
    expectKeys(pipeline.scan, ['includeHidden', 'excludeGlobs', 'fileCap', 'maxDepth'], `${path}.scan`, c, 'pipeline');
    const scan = pipeline.scan as Record<string, unknown>;
    if (scan.includeHidden !== undefined && typeof scan.includeHidden !== 'boolean') {
      c.add(`${path}.scan.includeHidden`, 'pipeline', 'includeHidden must be a boolean.');
    }
    checkGlobList(scan.excludeGlobs, `${path}.scan.excludeGlobs`, c, 256);
    if (scan.fileCap !== undefined) {
      if (typeof scan.fileCap !== 'number' || !Number.isInteger(scan.fileCap) || scan.fileCap < 1 || scan.fileCap > PACK_LIMITS.scanFileCapHard) {
        c.add(`${path}.scan.fileCap`, 'pipeline', `fileCap must be an integer 1–${PACK_LIMITS.scanFileCapHard}.`);
      }
    }
    if (scan.maxDepth !== undefined) {
      if (typeof scan.maxDepth !== 'number' || !Number.isInteger(scan.maxDepth) || scan.maxDepth < 1 || scan.maxDepth > PACK_LIMITS.scanDepthHard) {
        c.add(`${path}.scan.maxDepth`, 'pipeline', `maxDepth must be an integer 1–${PACK_LIMITS.scanDepthHard}.`);
      }
    }
  }

  const classifyPath = `${path}.classify`;
  if (!isRecord(pipeline.classify)) {
    c.add(classifyPath, 'pipeline', 'classify step is required.');
  } else {
    expectKeys(pipeline.classify, ['veto', 'keep', 'ask', 'candidate'], classifyPath, c, 'pipeline');
    const classify = pipeline.classify as Record<string, unknown>;
    let total = 0;
    for (const listId of ['veto', 'keep', 'ask', 'candidate'] as const) {
      const list = classify[listId];
      if (list === undefined) {
        continue;
      }
      if (!Array.isArray(list)) {
        c.add(`${classifyPath}.${listId}`, 'pipeline', `${listId} must be a rule array.`);
        continue;
      }
      total += list.length;
      list.forEach((raw, index) => {
        const rPath = `${classifyPath}.${listId}[${index}]`;
        if (!isRecord(raw)) {
          c.add(rPath, 'malformed', 'Expected a rule object.');
          return;
        }
        expectKeys(raw, ['id', 'when', 'note'], rPath, c, 'pipeline');
        const rule = raw as Record<string, unknown>;
        if (typeof rule.id !== 'string' || !RULE_ID_RE.test(rule.id)) {
          c.add(`${rPath}.id`, 'malformed', 'Rule ids are lowercase alphanumeric/dash (≤ 40 chars).');
          return;
        }
        if (rules.has(rule.id)) {
          c.add(`${rPath}.id`, 'cross-reference', `Duplicate rule id "${rule.id}".`);
          return;
        }
        rules.add(rule.id);
        requiredKeys.add(`rule.${rule.id}`);
        if (rule.note !== undefined && (typeof rule.note !== 'string' || rule.note.length > 200)) {
          c.add(`${rPath}.note`, 'malformed', 'note must be a string (≤ 200 chars).');
        }
      });
    }
    if (total > PACK_LIMITS.classifyRulesMax) {
      c.add(classifyPath, 'limits', `Too many classify rules (${total} > ${PACK_LIMITS.classifyRulesMax}).`);
    }
    if (total === 0) {
      c.add(classifyPath, 'pipeline', 'classify requires at least one rule.');
    }
  }

  const signals: SignalContext = { rules, config: pack.configKeys, questions };
  if (pipeline.decide !== undefined) {
    const dPath = `${path}.decide`;
    if (!isRecord(pipeline.decide)) {
      c.add(dPath, 'pipeline', 'decide must be an object.');
    } else {
      expectKeys(pipeline.decide, ['questions', 'readContext', 'readContextWhen'], dPath, c, 'pipeline');
      const decide = pipeline.decide as Record<string, unknown>;
      const collected = checkQuestions(decide.questions, `${dPath}.questions`, c);
      for (const id of collected.keys()) {
        questions.set(id, collected.get(id) as PackQuestionType);
      }
      if (decide.readContext !== undefined && typeof decide.readContext !== 'boolean') {
        c.add(`${dPath}.readContext`, 'pipeline', 'readContext must be a boolean.');
      }
      if (decide.readContextWhen !== undefined) {
        checkCondition(decide.readContextWhen, `${dPath}.readContextWhen`, c, signals);
      }
    }
  }
  if (pack.capabilities.has('decision') && pipeline.decide === undefined) {
    c.add(`${path}.decide`, 'cross-reference', 'The decision capability requires a decide step.');
  }

  const composePath = `${path}.compose`;
  if (!isRecord(pipeline.compose)) {
    c.add(composePath, 'pipeline', 'compose step is required.');
  } else {
    expectKeys(pipeline.compose, ['keepWhen', 'candidateWhen', 'askWhen'], composePath, c, 'pipeline');
    const compose = pipeline.compose as Record<string, unknown>;
    for (const key of ['keepWhen', 'candidateWhen', 'askWhen'] as const) {
      if (compose[key] !== undefined) {
        checkCondition(compose[key], `${composePath}.${key}`, c, signals);
      }
    }
  }

  if (pipeline.propose !== undefined) {
    hasPropose = true;
    const pPath = `${path}.propose`;
    if (!isRecord(pipeline.propose)) {
      c.add(pPath, 'pipeline', 'propose must be an object.');
    } else {
      expectKeys(pipeline.propose, ['verb', 'groupBy', 'gate'], pPath, c, 'pipeline');
      const propose = pipeline.propose as Record<string, unknown>;
      if (!(PACK_PROPOSE_VERBS as readonly string[]).includes(propose.verb as string)) {
        c.add(`${pPath}.verb`, 'pipeline', `Unknown propose verb (apiVersion ${PACK_API_VERSION} allows: ${PACK_PROPOSE_VERBS.join(', ')}).`);
      } else if (!pack.capabilities.has('fs-write-quarantine')) {
        c.add(`${pPath}.verb`, 'cross-reference', 'The quarantine verb requires the fs-write-quarantine capability.');
      }
      if (propose.groupBy !== undefined) {
        if (typeof propose.groupBy !== 'string') {
          c.add(`${pPath}.groupBy`, 'malformed', 'groupBy must be a signal path.');
        } else {
          checkSignalPath(propose.groupBy, `${pPath}.groupBy`, c, signals);
        }
      }
      const gate = propose.gate;
      if (!isRecord(gate) || typeof gate.minConfidence !== 'number' || gate.minConfidence < 0 || gate.minConfidence > 1) {
        c.add(`${pPath}.gate.minConfidence`, 'pipeline', 'gate.minConfidence must be a number 0–1 (required for the fail-closed gate).');
      } else {
        expectKeys(gate, ['minConfidence'], `${pPath}.gate`, c, 'pipeline');
      }
    }
  }

  if (isRecord(pipeline.classify)) {
    for (const [listId, list] of Object.entries(pipeline.classify)) {
      if (!Array.isArray(list)) {
        continue;
      }
      list.forEach((entry, index) => {
        if (!isRecord(entry)) {
          return;
        }
        checkCondition(entry.when, `${path}.classify.${listId}[${index}].when`, c, signals);
      });
    }
  }

  return { questions, rules, hasPropose, requiredKeys };
}

export function validateManifest(input: unknown, options: ValidatePackOptions = {}): PackValidationResult {
  const c = new Collector();

  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '$', code: 'malformed', message: 'A pack manifest must be a JSON object.' }] };
  }
  const raw = JSON.stringify(input);
  if (raw.length > PACK_LIMITS.manifestMaxBytes) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'limits', message: `Manifest exceeds ${PACK_LIMITS.manifestMaxBytes} bytes.` }],
    };
  }

  const base = input as Record<string, unknown>;
  expectKeys(
    base,
    [
      'apiVersion', 'id', 'version', 'kind', 'title', 'description', 'icon',
      'author', 'license', 'repository', 'categories', 'docs', 'capabilities',
      'configSchema', 'defaults', 'runParams', 'privacy', 'run', 'report', 'liveCard', 'i18n', 'contributions', 'code', 'secrets',
    ],
    '$', c, 'malformed'
  );

  if (options.sandboxed && base.kind !== 'surface') {
    c.add('$.kind', 'kind', 'Sandboxed code packs contribute surfaces — the assessment pipeline is host-side (ADR-0030 clause 3).');
  }

  if (base.apiVersion === undefined || typeof base.apiVersion !== 'number' || !Number.isInteger(base.apiVersion)) {
    c.add('$.apiVersion', 'api-version', 'apiVersion must be an integer.');
  } else if (base.apiVersion > PACK_API_VERSION) {
    c.add('$.apiVersion', 'api-version', `requires host apiVersion >= ${base.apiVersion} (host: ${PACK_API_VERSION}).`);
  } else if (PACK_API_VERSION - base.apiVersion >= PACK_DEPRECATION_WINDOW_MAJORS) {
    c.add('$.apiVersion', 'api-version', `apiVersion ${base.apiVersion} is outside the ${PACK_DEPRECATION_WINDOW_MAJORS}-major deprecation window.`);
  }

  const packId = base.id;
  if (typeof packId !== 'string' || !ID_RE.test(packId)) {
    c.add('$.id', 'identity', `id must match ${PACK_ID_PATTERN}.`);
  } else if (PACK_RESERVED_ID_PREFIXES.some((prefix) => packId.startsWith(prefix))) {
    c.add('$.id', 'reserved', `id prefix is host-reserved (${PACK_RESERVED_ID_PREFIXES.join(', ')}).`);
  }
  if (typeof base.version !== 'string' || !VERSION_RE.test(base.version)) {
    c.add('$.version', 'identity', 'version must be semver (e.g. 1.0.0).');
  }
  checkEnvelopeSharedFields(base, c);
  if (base.icon !== undefined) {
    if (typeof base.icon !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(base.icon)) {
      c.add('$.icon', 'malformed', 'icon must be an inline raster data-URL (png/jpeg/webp) — SVG/XPM are rejected.');
    } else if (base.icon.length > PACK_LIMITS.iconMaxBytes) {
      c.add('$.icon', 'limits', `icon exceeds ${PACK_LIMITS.iconMaxBytes} bytes.`);
    }
  }

  const kind = base.kind;
  if (kind !== 'assessment' && kind !== 'surface') {
    c.add('$.kind', 'kind', `kind must be one of: ${PACK_KINDS.join(', ')}.`);
  }

  const capabilities = new Set<string>();
  if (!Array.isArray(base.capabilities) || base.capabilities.length === 0) {
    c.add('$.capabilities', 'capability', 'capabilities must be a non-empty array.');
  } else {
    for (const capability of base.capabilities) {
      if (typeof capability !== 'string') {
        c.add('$.capabilities', 'capability', 'Capabilities must be strings.');
        continue;
      }
      if (capabilities.has(capability)) {
        c.add('$.capabilities', 'capability', `Duplicate capability "${capability}".`);
        continue;
      }
      capabilities.add(capability);
      if (options.sandboxed) {
        if (capability === 'net') {
          c.add('$.capabilities', 'reserved', 'Capability "net" is the exfiltration class — denied for imported code packs (ADR-0029 clause 6, ADR-0030 clauses 4/6).');
        } else if (!SANDBOX_CAPABILITIES.includes(capability)) {
          c.add('$.capabilities', 'reserved', `Capability "${capability}" is not grantable to imported code packs on this host (sandbox v1 grants: ${SANDBOX_CAPABILITIES.join(', ')}).`);
        }
        continue;
      }
      if (!(PACK_CAPABILITIES as readonly string[]).includes(capability)) {
        c.add('$.capabilities', 'capability', `Unknown capability "${capability}".`);
        continue;
      }
      const tiers = PACK_CAPABILITY_TIERS[capability] ?? [];
      if (tiers.length === 0) {
        c.add(
          '$.capabilities',
          'reserved',
          `Capability "${capability}" is reserved for a later contract version — requires contract apiVersion >= 2.`
        );
        continue;
      }
      if (!options.bundled && (tiers as readonly number[]).every((t) => t > 0)) {
        c.add('$.capabilities', 'reserved', `Capability "${capability}" is a trusted-tier (bundled-code) privilege and cannot be imported.`);
      }
    }
  }

  if (base.code !== undefined && !options.bundled && !options.sandboxed) {
    c.add('$.code', 'reserved', 'Imported packs cannot carry code entries (Tier 0 is declarative only).');
  }
  if (options.sandboxed && base.code === undefined) {
    c.add('$.code', 'cross-reference', 'Sandboxed validation requires a code entry — Tier 2 is provenance from installed content carrying code.');
  }
  if (base.code !== undefined && (options.bundled || options.sandboxed)) {
    if (!isRecord(base.code)) {
      c.add('$.code', 'malformed', 'code must be an object.');
    } else {
      expectKeys(base.code, ['entry'], '$.code', c, 'malformed');
      const entry = (base.code as Record<string, unknown>).entry;
      if (typeof entry !== 'string' || entry.length === 0 || entry.length > 255) {
        c.add('$.code.entry', 'malformed', 'code.entry must be a non-empty relative path (≤ 255 chars).');
      } else if (
        entry.includes('\\') ||
        entry.includes('..') ||
        entry.startsWith('/') ||
        !entry.split('/').every((segment) => /^[a-z0-9][a-z0-9._-]{0,127}$/.test(segment)) ||
        !entry.endsWith('.js')
      ) {
        c.add('$.code.entry', 'malformed', 'code.entry must be a relative .js path of [a-z0-9._-] segments without traversal.');
      }
    }
  }
  if (base.contributions !== undefined) {
    if (!isRecord(base.contributions)) {
      c.add('$.contributions', 'malformed', 'contributions must be a slot map.');
    } else {
      for (const slot of Object.keys(base.contributions)) {
        if (!(PACK_SLOTS as readonly string[]).includes(slot)) {
          c.add(`$.contributions.${slot}`, 'pipeline', `Unknown slot "${slot}".`);
        }
        const entries = (base.contributions as Record<string, unknown>)[slot];
        if (options.sandboxed && Array.isArray(entries)) {
          entries.forEach((entry, index) => {
            const id = (isRecord(entry) ? entry.id : undefined) as unknown;
            if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,39}:[a-z][a-z0-9:._-]{0,63}$/.test(id)) {
              c.add(`$.contributions.${slot}[${index}].id`, 'malformed', 'Sandboxed contribution ids are namespaced (<namespace>:<name>) — the namespace is the sandbox op prefix, and reserved ops stay unreachable.');
            }
          });
        }
      }
      if (!options.bundled && !options.sandboxed) {
        c.add('$.contributions', 'reserved', 'Slot contributions are a bundled-code (Tier 1) privilege.');
      }
    }
  }
  if (base.secrets !== undefined) {
    if (!options.sandboxed) {
      c.add('$.secrets', 'reserved', 'Manifest secret slots are an imported-code-pack (Tier 2) declaration.');
    } else if (!Array.isArray(base.secrets) || base.secrets.some((slot) => !isRecord(slot) || typeof (slot as Record<string, unknown>).id !== 'string')) {
      c.add('$.secrets', 'malformed', 'secrets must be an array of { id } slot declarations.');
    } else {
      const slots = (base.secrets as Record<string, unknown>[]).map((slot) => slot.id as string);
      if (slots.length > 16) {
        c.add('$.secrets', 'limits', 'Too many secret slots (16 max).');
      }
      slots.forEach((slot, index) => {
        if (!SANDBOX_SLOT_PATTERN.test(slot)) {
          c.add(`$.secrets[${index}].id`, 'malformed', 'Slot ids are lowercase alphanumeric/dash (≤ 64 chars).');
        }
      });
      if (new Set(slots).size !== slots.length) {
        c.add('$.secrets', 'cross-reference', 'Duplicate secret slot id.');
      }
    }
  }

  const configKeys = checkConfigSchema(base.configSchema, '$.configSchema', c);
  checkConfigSchema(base.runParams, '$.runParams', c);
  if (base.defaults !== undefined && !isRecord(base.defaults)) {
    c.add('$.defaults', 'config-schema', 'defaults must be an object.');
  }

  const requiredI18n = new Set<string>(['title']);

  if (kind === 'assessment') {
    if (!isRecord(base.privacy)) {
      c.add('$.privacy', 'privacy', 'Assessment packs require a privacy declaration.');
    } else {
      expectKeys(base.privacy, ['sendsContent', 'sensitiveGlobs', 'contentCapBytes'], '$.privacy', c, 'privacy');
      const privacy = base.privacy as Record<string, unknown>;
      if (typeof privacy.sendsContent !== 'boolean') {
        c.add('$.privacy.sendsContent', 'privacy', 'sendsContent must be a boolean.');
      }
      checkGlobList(privacy.sensitiveGlobs, '$.privacy.sensitiveGlobs', c, 256);
      if (
        privacy.contentCapBytes !== undefined &&
        (typeof privacy.contentCapBytes !== 'number' || privacy.contentCapBytes < 1 || privacy.contentCapBytes > PACK_LIMITS.contentExcerptMaxBytes)
      ) {
        c.add('$.privacy.contentCapBytes', 'privacy', `contentCapBytes must be 1–${PACK_LIMITS.contentExcerptMaxBytes}.`);
      }
    }
  } else if (kind === 'surface' && base.privacy !== undefined) {
    c.add('$.privacy', 'kind', 'Surface packs do not scan files and cannot declare privacy.');
  }

  const pipelineInfo = { questions: new Map<string, PackQuestionType>(), rules: new Set<string>(), hasPropose: false, requiredKeys: new Set<string>() };
  if (kind === 'assessment') {
    const info = checkPipeline(base.run, '$.run', c, { capabilities, configKeys });
    pipelineInfo.questions = info.questions;
    pipelineInfo.rules = info.rules;
    pipelineInfo.hasPropose = info.hasPropose;
    pipelineInfo.requiredKeys = info.requiredKeys;
    if (base.run !== undefined && isRecord(base.run)) {
      const decide = (base.run as Record<string, unknown>).decide;
      if (isRecord(decide) && (decide.readContext === true || decide.readContextWhen !== undefined) && isRecord(base.privacy) && (base.privacy as Record<string, unknown>).sendsContent !== true) {
        c.add('$.run.decide.readContext', 'privacy', 'reading content requires privacy.sendsContent (privacy-consistency lint).');
      }
    }
    for (const key of configKeys.keys()) {
      requiredI18n.add(`config.${key}`);
    }
    for (const key of pipelineInfo.requiredKeys) {
      requiredI18n.add(key);
    }
  } else if (kind === 'surface' && base.run !== undefined) {
    c.add('$.run', 'kind', 'Surface packs must not declare a run pipeline.');
  }

  if (capabilities.has('report')) {
    if (base.report === undefined) {
      c.add('$.report', 'report', 'The report capability requires a report schema.');
    } else if (kind === 'assessment') {
      const report = base.report as Record<string, unknown>;
      if (isRecord(report) && Array.isArray(report.nodes)) {
        for (const node of report.nodes) {
          if (isRecord(node) && typeof node.id === 'string' && node.type !== 'actions') {
            requiredI18n.add(`report.${node.id}`);
          }
        }
      }
      checkReport(base.report, '$.report', c, { capabilities, hasPropose: pipelineInfo.hasPropose });
    } else {
      c.add('$.report', 'kind', 'Report schemas belong to assessment packs.');
    }
  } else if (base.report !== undefined) {
    c.add('$.report', 'capability', 'A report schema requires the report capability.');
  }

  if (base.liveCard !== undefined) {
    if (kind !== 'assessment') {
      c.add('$.liveCard', 'kind', 'Live cards belong to assessment packs.');
    } else {
      checkLiveCard(base.liveCard, '$.liveCard', c);
      const liveCard = base.liveCard as Record<string, unknown>;
      if (isRecord(liveCard) && Array.isArray(liveCard.nodes)) {
        for (const node of liveCard.nodes) {
          if (isRecord(node) && typeof node.id === 'string' && node.type === 'stat') {
            requiredI18n.add(`live.${node.id}`);
          }
        }
      }
    }
  }

  if (capabilities.has('run') && kind !== 'assessment') {
    c.add('$.capabilities', 'capability', 'The run capability belongs to assessment packs.');
  }
  if (capabilities.has('fs-read') && kind !== 'assessment') {
    c.add('$.capabilities', 'capability', 'The fs-read capability belongs to assessment packs.');
  }
  if (kind === 'assessment') {
    if (!capabilities.has('fs-read')) {
      c.add('$.capabilities', 'cross-reference', 'Assessment packs scan a root — the fs-read capability is required.');
    }
    if (!capabilities.has('run')) {
      c.add('$.capabilities', 'cross-reference', 'Assessment packs execute runs — the run capability is required.');
    }
  }
  if (capabilities.has('fs-write-quarantine') && !pipelineInfo.hasPropose) {
    c.add('$.run.propose', 'cross-reference', 'The fs-write-quarantine capability requires a propose step.');
  }
  if (capabilities.has('ui:window') && !capabilities.has('report')) {
    c.add('$.capabilities', 'cross-reference', 'The ui:window capability renders the pack report surface and requires the report capability (ADR-0040 clause 16).');
  }
  if (options.sandboxed) {
    const contributions = isRecord(base.contributions) ? (base.contributions as Record<string, unknown>) : {};
    const declaresChatSlot = CHAT_SLOTS.some((slot) => Array.isArray(contributions[slot]) && contributions[slot].length > 0);
    if (declaresChatSlot && !capabilities.has('ui:chat-card')) {
      c.add('$.capabilities', 'cross-reference', 'Chat-surface contributions (commands, input modes) require the ui:chat-card capability.');
    }
    if (Array.isArray(contributions['settings-page']) && contributions['settings-page'].length > 0 && !capabilities.has('ui:settings')) {
      c.add('$.capabilities', 'cross-reference', 'A settings-page contribution requires the ui:settings capability.');
    }
    if (capabilities.has('secrets') && base.secrets === undefined) {
      c.add('$.secrets', 'cross-reference', 'The secrets capability requires declared secret slots.');
    }
  }

  checkI18n(base.i18n, '$.i18n', c, requiredI18n);

  if (c.failed) {
    return { ok: false, issues: c.issues };
  }

  const manifest = input as unknown as PackManifest;
  return {
    ok: true,
    pack: {
      manifest,
      requiredI18nKeys: [...requiredI18n].sort(),
      configKeys: [...configKeys.keys()],
    },
  };
}

/** Effective config: defaults merged with stored values, validated against the schema subset. */
export function validatePackConfig(
  pack: ValidatedPack,
  values: unknown
): { ok: true; values: Record<string, unknown> } | { ok: false; issues: PackValidationIssue[] } {
  const schema = pack.manifest.configSchema;
  const issues: PackValidationIssue[] = [];
  const out: Record<string, unknown> = {};
  if (!schema) {
    if (values !== undefined && Object.keys(isRecord(values) ? values : {}).length > 0) {
      return { ok: false, issues: [{ path: '$', code: 'config-schema', message: 'Pack declares no config.' }] };
    }
    return { ok: true, values: out };
  }
  if (values !== undefined && !isRecord(values)) {
    return { ok: false, issues: [{ path: '$', code: 'config-schema', message: 'Config values must be an object.' }] };
  }
  const input = (values ?? {}) as Record<string, unknown>;
  for (const [key, fieldRaw] of Object.entries(schema.properties)) {
    const field = fieldRaw as PackConfigField;
    const path = `$.${key}`;
    const value = key in input ? input[key] : field.default;
    if (value === undefined) {
      issues.push({ path, code: 'config-schema', message: 'Required value (the field declares no default).' });
      continue;
    }
    if (field.type === 'string') {
      if (typeof value !== 'string') {
        issues.push({ path, code: 'config-schema', message: 'Expected a string.' });
        continue;
      }
      if (field.minLength !== undefined && value.length < field.minLength) issues.push({ path, code: 'config-schema', message: `Minimum length ${field.minLength}.` });
      if (field.maxLength !== undefined && value.length > field.maxLength) issues.push({ path, code: 'config-schema', message: `Maximum length ${field.maxLength}.` });
      if (field.enum && !field.enum.includes(value)) issues.push({ path, code: 'config-schema', message: `Value must be one of: ${field.enum.join(', ')}.` });
      if (field.pattern) {
        if (value.length > PATTERN_SUBJECT_MAX_CHARS) {
          issues.push({ path, code: 'config-schema', message: `Value exceeds the pattern-check length cap (${PATTERN_SUBJECT_MAX_CHARS}).` });
        } else {
          try {
            if (!new RegExp(field.pattern).test(value)) issues.push({ path, code: 'config-schema', message: `Value must match ${field.pattern}.` });
          } catch {
            issues.push({ path, code: 'config-schema', message: 'Stored pattern is invalid.' });
          }
        }
      }
      out[key] = value;
    } else if (field.type === 'number') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        issues.push({ path, code: 'config-schema', message: 'Expected a number.' });
        continue;
      }
      if (field.minimum !== undefined && numeric < field.minimum) issues.push({ path, code: 'config-schema', message: `Minimum ${field.minimum}.` });
      if (field.maximum !== undefined && numeric > field.maximum) issues.push({ path, code: 'config-schema', message: `Maximum ${field.maximum}.` });
      out[key] = numeric;
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') {
        issues.push({ path, code: 'config-schema', message: 'Expected a boolean.' });
        continue;
      }
      out[key] = value;
    } else {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        issues.push({ path, code: 'config-schema', message: 'Expected a string array.' });
        continue;
      }
      if (field.minItems !== undefined && value.length < field.minItems) issues.push({ path, code: 'config-schema', message: `Minimum ${field.minItems} items.` });
      if (field.maxItems !== undefined && value.length > field.maxItems) issues.push({ path, code: 'config-schema', message: `Maximum ${field.maxItems} items.` });
      if (field.items.enum && !value.every((v) => field.items.enum?.includes(v))) issues.push({ path, code: 'config-schema', message: 'Value outside the allowed set.' });
      out[key] = value;
    }
  }
  for (const key of Object.keys(input)) {
    if (!(key in schema.properties)) {
      issues.push({ path: `$.${key}`, code: 'config-schema', message: 'Unknown config key.' });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, values: out };
}
