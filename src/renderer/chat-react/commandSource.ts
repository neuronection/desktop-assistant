import { searchScore } from '@neuronection/assistant-ui/fuzzy';
import type { CommandCatalogSnapshot, CommandCategory, CommandEntry } from '@shared/commands';
import { entryAliases, parseCommandArgs, parseCommandInput, parsePalettePrefix, tokenizeArgs, resolveCommandAlias, OPEN_DISPATCH_ALIAS, resolveOpenTarget } from '@shared/commands';
import { isLanguageCode } from '@shared/languages';
import { TEXT } from '@shared/constants/text';

/**
 * Catalog snapshot cache — fetched fresh once per palette summon
 * (plan 14 §2 freshness rule); submit-time slash resolution reads the
 * same cache so direct typing and the palette agree on semantics.
 */
let cache: CommandCatalogSnapshot | null = null;
let inflight: Promise<CommandCatalogSnapshot> | null = null;

export function cachedCommandCatalog(): CommandCatalogSnapshot | null {
  return cache;
}

export function invalidateCommandCatalog(): void {
  cache = null;
  inflight = null;
}

export async function loadCommandCatalog(force = false): Promise<CommandCatalogSnapshot> {
  if (!force && cache) {
    return cache;
  }
  if (!force && inflight) {
    return inflight;
  }
  inflight = window.electronAPI
    .getCommandCatalog()
    .then((snapshot) => {
      cache = snapshot;
      inflight = null;
      return snapshot;
    })
    .catch((error) => {
      inflight = null;
      throw error;
    });
  return inflight;
}

/**
 * Usage boost from recency position — only ever reorders within a field
 * tier; tiers themselves compare structurally (see FIELD_TARGETS), so a
 * boost can never outrank a match on a higher-priority field (plan 14 D2).
 */
export const RECENT_BOOST_VALUES = [8, 6, 4, 2];

/** Frequency boost cap — frequency decides ties, it never outranks a field tier. */
export const FREQUENCY_BOOST_CAP = 6;

/** `log2(1 + uses) × 1.5`, capped: 1 use = 1.5, 3 = 3, 7 = 4.5, 15 = 6. */
export function frequencyBoost(count: number | undefined): number {
  if (!count || count <= 0) {
    return 0;
  }
  return Math.min(FREQUENCY_BOOST_CAP, Math.log2(1 + count) * 1.5);
}

/**
 * Field-priority search tiers (plan 14 §2 feedback): a keyword (slash or
 * alias) match outranks a title match, then keywords, description, and —
 * last — the bare category. Tiers compare lexicographically before fuzzy
 * score, so a category string ("web") no longer ties with the command's
 * own slash keyword, and the description participates without letting
 * prose matches bury name matches.
 */
export const SEARCH_TIERS = ['keyword', 'title', 'keywords', 'description', 'category'] as const;
export type SearchTier = (typeof SEARCH_TIERS)[number];

const TIER_RANK: Record<SearchTier, number> = Object.fromEntries(
  SEARCH_TIERS.map((tier, index) => [tier, index])
) as Record<SearchTier, number>;

const FIELD_TARGETS: { tier: SearchTier; targets: (entry: CommandEntry) => string[] }[] = [
  { tier: 'keyword', targets: (entry) => entryAliases(entry) },
  { tier: 'title', targets: (entry) => [entry.title] },
  { tier: 'keywords', targets: (entry) => entry.keywords ?? [] },
  { tier: 'description', targets: (entry) => (entry.subtitle ? [entry.subtitle] : []) },
  { tier: 'category', targets: (entry) => [entry.category] },
];

export interface FieldMatch {
  tier: SearchTier;
  /** Library fuzzy score within the tier. */
  score: number;
}

export function bestFieldMatch(entry: CommandEntry, query: string): FieldMatch | null {
  let best: FieldMatch | null = null;
  for (const { tier, targets } of FIELD_TARGETS) {
    for (const target of targets(entry)) {
      const score = searchScore(query, target);
      if (score !== null && (!best || TIER_RANK[tier] < TIER_RANK[best.tier] || (tier === best.tier && score > best.score))) {
        best = { tier, score };
      }
    }
  }
  return best;
}

export interface RankedEntry {
  entry: CommandEntry;
  tier: SearchTier;
  score: number;
}

const compareRanked = (a: RankedEntry, b: RankedEntry): number =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
  b.score - a.score ||
  categoryRank(a.entry.category) - categoryRank(b.entry.category) ||
  a.entry.id.localeCompare(b.entry.id);

/** Ranks catalog entries against a query; field tiers beat fuzzy score (D2). */
export function rankEntries(
  entries: CommandEntry[],
  query: string,
  recentIds: string[] = [],
  counts: Record<string, number> = {}
): RankedEntry[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const boostFor = new Map<string, number>();
  recentIds.forEach((id, index) => {
    if (index < RECENT_BOOST_VALUES.length) {
      boostFor.set(id, RECENT_BOOST_VALUES[index] as number);
    }
  });
  const ranked: RankedEntry[] = [];
  for (const entry of entries) {
    const match = bestFieldMatch(entry, trimmed);
    if (!match) {
      continue;
    }
    const score = match.score + (boostFor.get(entry.id) ?? 0) + frequencyBoost(counts[entry.id]);
    ranked.push({ entry, tier: match.tier, score });
  }
  ranked.sort(compareRanked);
  return ranked;
}

export interface PaletteSection {
  key: string;
  label: string;
  items: RankedEntry[];
}

// Tie-break order for equal-ranked results (plan 14 §2 feedback):
// internal tools before external apps.
const CATEGORY_ORDER: CommandCategory[] = ['tools', 'web', 'navigation', 'custom', 'integrations', 'apps'];

const categoryRank = (category: CommandCategory): number => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
};

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  apps: TEXT.COMMAND_CATEGORY_APPS,
  tools: TEXT.COMMAND_CATEGORY_TOOLS,
  web: TEXT.COMMAND_CATEGORY_WEB,
  navigation: TEXT.COMMAND_CATEGORY_NAVIGATION,
  custom: TEXT.COMMAND_CATEGORY_CUSTOM,
  integrations: TEXT.COMMAND_CATEGORY_INTEGRATIONS,
};

const SUGGESTED_IDS = ['tool:screen_capture', 'calc:evaluate', 'files:search', 'nav:open-settings', 'nav:new-conversation'];

/** A tool used within this window is still "fresh" enough to sit on the palette's launch pad (plan 72). */
export const PALETTE_RECENT_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Fresh tools shown under the suggestions — 3 so the list still reads as a launch pad. */
export const PALETTE_RECENT_MAX = 3;
/** Static opening ideas — 4 so pins + suggestions + recents stay under ~8 rows. */
export const PALETTE_SUGGESTED_MAX = 4;
/** Browse rows per category under the launch pad — the list stays a launch pad; typing searches everything. */
export const PALETTE_BROWSE_PER_CATEGORY = 8;

export interface PaletteModel {
  query: string;
  argv: string[];
  alias: string | null;
  /** Empty query → pinned/suggested/recent sections + a capped per-category browser. */
  sections: PaletteSection[];
  total: number;
  /** Browse rows left out by the per-category cap — typing searches them. */
  browseHidden?: number;
}

/** Pin/recent/suggested/exact rows are ordered by construction, not searched. */
const unranked = (entry: CommandEntry): RankedEntry => ({ entry, tier: 'keyword', score: 0 });

/** Builds the full palette view model from a snapshot + composer query (the text after `/`). */
export function buildPaletteModel(
  snapshot: CommandCatalogSnapshot,
  query: string,
  excludeIds: string[] = [],
  extraEntries: CommandEntry[] = [],
  now: number = Date.now()
): PaletteModel {
  const parsed = parseCommandInput(`/${query}`);
  const argv = parsed.argv;
  const alias = parsed.alias;
  const excluded = new Set(excludeIds);
  const entries = [
    ...snapshot.entries.filter((entry) => !excluded.has(entry.id) && entry.scopes.palette && !entry.disabled),
    ...extraEntries,
  ];
  const entryIds = new Set(entries.map((entry) => entry.id));
  const recentOrder = [...snapshot.recent].sort((a, b) => b.usedAt - a.usedAt).map((use) => use.id);
  const counts: Record<string, number> = {};
  for (const use of snapshot.recent) {
    if (use.count !== undefined) {
      counts[use.id] = use.count;
    }
  }

  const prefix = parsePalettePrefix(query);
  if (prefix.kind !== 'none') {
    const argv = tokenizeArgs(prefix.query);
    const pick = (entry: CommandEntry): RankedEntry[] => [{ entry, tier: 'keyword', score: 0 }];
    if (prefix.kind === 'web' || prefix.kind === 'calc') {
      const target =
        prefix.kind === 'calc'
          ? entries.find((entry) => entry.id === 'calc:evaluate' || entry.action === 'calc:evaluate')
          : entries.find((entry) => entry.id === 'tool:web_search') ?? entries.find((entry) => entry.category === 'web');
      const rows = target ? pick(target) : [];
      return {
        query,
        argv,
        alias: null,
        sections: rows.length > 0 ? [{ key: 'prefix', label: CATEGORY_LABELS[rows[0]!.entry.category], items: rows }] : [],
        total: rows.length,
      };
    }
    const filtered =
      prefix.kind === 'apps'
        ? entries.filter((entry) => entry.category === 'apps')
        : entries.filter((entry) => entry.category !== 'apps');
    const ranked = prefix.query ? rankEntries(filtered, prefix.query, recentOrder, counts) : filtered.map(unranked);
    return {
      query,
      argv,
      alias: null,
      sections:
        ranked.length > 0 ? [{ key: 'prefix', label: TEXT.COMMAND_GROUP_RESULTS, items: ranked }] : [],
      total: ranked.length,
    };
  }

  // Exact typed command names collapse the view to that command; reserved
  // names whose command is filtered out (e.g. Quit during a mini app)
  // suppress fuzzy noise entirely (plan 14 §9).
  if (alias) {
    const reserved = new Set<string>();
    for (const entry of snapshot.entries) {
      if (entry.source !== 'system') {
        continue;
      }
      for (const candidate of entryAliases(entry)) {
        reserved.add(candidate);
      }
    }
    reserved.add('open');
    if (reserved.has(alias)) {
      const exact = entries.find((entry) => entryAliases(entry).includes(alias));
      if (exact) {
        return {
          query,
          argv,
          alias,
          sections: [{ key: exact.category, label: CATEGORY_LABELS[exact.category], items: [unranked(exact)] }],
          total: 1,
        };
      }
      return { query, argv, alias, sections: [], total: 0 };
    }
  }

  if (!alias) {
    const entryFor = (id: string): CommandEntry | undefined =>
      entryIds.has(id) ? snapshot.entries.find((entry) => entry.id === id) : undefined;
    const pinned = snapshot.pins
      .map(entryFor)
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .map(unranked);
    const pinnedIds = new Set(snapshot.pins);
    const freshRecents = snapshot.recent
      .filter((use) => use.usedAt >= now - PALETTE_RECENT_WINDOW_MS && !pinnedIds.has(use.id))
      .sort((a, b) => b.usedAt - a.usedAt)
      .map((use) => entryFor(use.id))
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .slice(0, PALETTE_RECENT_MAX);
    const recentIds = new Set(freshRecents.map((entry) => entry.id));
    const suggestedEntries = SUGGESTED_IDS.filter((id) => !pinnedIds.has(id) && !recentIds.has(id))
      .map(entryFor)
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .slice(0, PALETTE_SUGGESTED_MAX);
    const suggested = suggestedEntries.map(unranked);
    const recent = freshRecents.filter((entry) => !suggestedEntries.some((suggestion) => suggestion.id === entry.id)).map(unranked);
    const sections: PaletteSection[] = [];
    if (extraEntries.length > 0) {
      sections.unshift({
        key: 'mode',
        label: TEXT.COMMAND_MINI_GROUP,
        items: extraEntries.map(unranked),
      });
    }
    if (pinned.length > 0) {
      sections.push({ key: 'pinned', label: TEXT.COMMAND_GROUP_PINNED, items: pinned });
    }
    if (suggested.length > 0) {
      sections.push({ key: 'suggested', label: TEXT.COMMAND_GROUP_SUGGESTED, items: suggested });
    }
    if (recent.length > 0) {
      sections.push({ key: 'recent', label: TEXT.COMMAND_GROUP_RECENT, items: recent });
    }

    // Below the launch pad the palette is still a complete browser: every
    // command the catalog carries, grouped by category, so an empty query
    // never hides an option behind a guessed word.
    const shown = new Set<string>([
      ...pinned.map((row) => row.entry.id),
      ...suggested.map((row) => row.entry.id),
      ...recent.map((row) => row.entry.id),
      ...extraEntries.map((entry) => entry.id),
    ]);
    const browse = new Map<CommandCategory, CommandEntry[]>();
    for (const entry of entries) {
      if (shown.has(entry.id)) {
        continue;
      }
      const list = browse.get(entry.category) ?? [];
      list.push(entry);
      browse.set(entry.category, list);
    }
    let hiddenBrowse = 0;
    const browseSections: PaletteSection[] = [...browse.entries()]
      .sort(([left], [right]) => categoryRank(left) - categoryRank(right))
      .map(([category, list]) => {
        const sorted = [...list].sort((left, right) => left.title.localeCompare(right.title));
        hiddenBrowse += Math.max(0, sorted.length - PALETTE_BROWSE_PER_CATEGORY);
        return {
          key: `browse:${category}`,
          label: CATEGORY_LABELS[category],
          items: sorted.slice(0, PALETTE_BROWSE_PER_CATEGORY).map(unranked),
        };
      });
    sections.push(...browseSections);
    const browseTotal = browseSections.reduce((sum, section) => sum + section.items.length, 0);
    return {
      query,
      argv,
      alias,
      sections,
      total: pinned.length + suggested.length + recent.length + browseTotal,
      ...(hiddenBrowse > 0 ? { browseHidden: hiddenBrowse } : {}),
    };
  }

  const ranked = rankEntries(entries, alias, recentOrder, counts);
  const pinOrder = new Map(snapshot.pins.map((id, index) => [id, index]));
  ranked.sort((a, b) => {
    const pinA = pinOrder.has(a.entry.id);
    const pinB = pinOrder.has(b.entry.id);
    if (pinA && pinB) {
      return (pinOrder.get(a.entry.id) as number) - (pinOrder.get(b.entry.id) as number);
    }
    if (pinA !== pinB) {
      return pinA ? -1 : 1;
    }
    return compareRanked(a, b);
  });
  const sections: PaletteSection[] =
    ranked.length > 0 ? [{ key: 'results', label: TEXT.COMMAND_GROUP_RESULTS, items: ranked }] : [];
  return { query, argv, alias, sections, total: ranked.length };
}

/** Formats a palette entry + argv back into composer slash input for the turn path. */
export function formatSlashEntry(entry: CommandEntry, argv: string[]): string {
  const alias = entry.slash ?? entry.aliases[0] ?? '';
  const rest = argv.join(' ').trim();
  return rest ? `/${alias} ${rest}` : `/${alias}`;
}

export interface WebSearchBehavior {
  /** Providers with keys enabled — zero means the D12 engine-URL fallback applies. */
  enabledProviders: number;
  behavior: 'inline' | 'browser';
  fallbackEngine: string;
}

/**
 * D12/§4: web search stays inline through the provider failover while
 * providers exist and the user has not chosen browser mode; otherwise
 * the query opens the configured engine URL — an API-key-free path
 * that always works.
 */
export function webSearchBrowserOverride(query: string, behavior: WebSearchBehavior): string | null {
  if (behavior.enabledProviders > 0 && behavior.behavior !== 'browser') {
    return null;
  }
  const engine = behavior.fallbackEngine.trim() || 'https://duckduckgo.com/?q=';
  const joiner = engine.includes('=') ? '' : ' ';
  const base = engine.endsWith('=') ? engine : `${engine}${joiner}`;
  return `${base}${encodeURIComponent(query.trim())}`;
}

export type SlashResolution =
  | { type: 'none' }
  | { type: 'unknown'; command: string }
  | { type: 'usage'; usage: string }
  | { type: 'builtin'; entry: CommandEntry; argv: string[] }
  | { type: 'custom'; entry: CommandEntry; argv: string[] }
  | { type: 'tool'; entry?: CommandEntry; direct: { name: string; args: Record<string, unknown>; commandId: string } };

function fillArgDefaults(entry: CommandEntry, args: Record<string, unknown>, defaults?: Record<string, unknown>): Record<string, unknown> {
  for (const spec of entry.args) {
    if ((args[spec.name] === undefined || args[spec.name] === '') && defaults?.[spec.name] !== undefined) {
      args[spec.name] = defaults[spec.name];
    }
  }
  return args;
}

/**
 * The translate grammar (plan 19 D5): `/tr [target] <text…>` — the first
 * token is the target only when it names a language (built-in or custom);
 * everything after it is the text. A lone language token is a usage error,
 * never a translation of the code itself.
 */
function translateArgs(
  rawRest: string,
  defaults: Record<string, unknown> | undefined,
  entry: CommandEntry,
  customLanguageCodes: string[]
): Record<string, unknown> {
  const tokens = rawRest.split(/\s+/).filter(Boolean);
  const first = (tokens[0] ?? '').toLowerCase();
  if (first && (isLanguageCode(first) || customLanguageCodes.includes(first))) {
    if (tokens.length === 1) {
      return fillArgDefaults(entry, { text: '', target: first }, defaults);
    }
    return fillArgDefaults(entry, { text: tokens.slice(1).join(' '), target: first }, defaults);
  }
  return fillArgDefaults(entry, { text: rawRest }, defaults);
}

function argsForEntry(
  entry: CommandEntry,
  argv: string[],
  rawRest: string,
  defaults?: Record<string, unknown>,
  customLanguageCodes: string[] = []
): Record<string, unknown> {
  if (entry.toolName === 'translate') {
    return translateArgs(rawRest, defaults, entry, customLanguageCodes);
  }
  return parseCommandArgs(entry, argv, rawRest, defaults);
}

/**
 * Resolves composer input that starts with `/` against the cached
 * catalog — the single slash semantics used by both the palette and
 * direct typing (plan 14 D1: main re-validates on execute). Configured
 * argument defaults fill values the user did not type.
 */
export function resolveSlashInput(
  input: string,
  argDefaults?: Record<string, Record<string, unknown>>,
  customLanguageCodes: string[] = []
): SlashResolution {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { type: 'none' };
  }
  const snapshot = cachedCommandCatalog();
  if (!snapshot) {
    return { type: 'none' };
  }
  const parsed = parseCommandInput(trimmed);
  if (!parsed.alias) {
    return { type: 'none' };
  }

  if (parsed.alias === OPEN_DISPATCH_ALIAS) {
    const rawRest = trimmed.slice(parsed.alias.length + 1).trim();
    const target = resolveOpenTarget(rawRest);
    if (!target) {
      return { type: 'usage', usage: TEXT.COMMAND_OPEN_USAGE };
    }
    return { type: 'tool', direct: { name: target.name, args: target.args, commandId: `tool:${target.name}` } };
  }

  const match = resolveCommandAlias(snapshot.entries, trimmed);
  if (!match) {
    return { type: 'unknown', command: parsed.alias };
  }
  if (match.entry.kind === 'tool' && match.entry.toolName) {
    const rawRest = trimmed.slice(parsed.alias.length + 1).trim();
    const args = argsForEntry(match.entry, match.argv, rawRest, argDefaults?.[match.entry.id], customLanguageCodes);
    return { type: 'tool', entry: match.entry, direct: { name: match.entry.toolName, args, commandId: match.entry.id } };
  }
  if (match.entry.kind === 'custom') {
    return { type: 'custom', entry: match.entry, argv: match.argv };
  }
  return { type: 'builtin', entry: match.entry, argv: match.argv };
}
