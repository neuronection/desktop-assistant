import { searchScore } from '@neuronection/assistant-ui/fuzzy';
import type { CommandCatalogSnapshot, CommandCategory, CommandEntry } from '@shared/commands';
import { entryAliases, parseCommandInput, resolveCommandAlias, OPEN_DISPATCH_ALIAS, resolveOpenTarget } from '@shared/commands';
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
export function rankEntries(entries: CommandEntry[], query: string, recentIds: string[] = []): RankedEntry[] {
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
    const score = match.score + (boostFor.get(entry.id) ?? 0);
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

export interface PaletteModel {
  query: string;
  argv: string[];
  alias: string | null;
  /** Empty query → pinned/recent/suggested sections; otherwise one mixed, score-ranked list. */
  sections: PaletteSection[];
  total: number;
}

/** Pin/recent/suggested/exact rows are ordered by construction, not searched. */
const unranked = (entry: CommandEntry): RankedEntry => ({ entry, tier: 'keyword', score: 0 });

/** Builds the full palette view model from a snapshot + composer query (the text after `/`). */
export function buildPaletteModel(
  snapshot: CommandCatalogSnapshot,
  query: string,
  excludeIds: string[] = [],
  extraEntries: CommandEntry[] = []
): PaletteModel {
  const parsed = parseCommandInput(`/${query}`);
  const argv = parsed.argv;
  const alias = parsed.alias;
  const excluded = new Set(excludeIds);
  const entries = [
    ...snapshot.entries.filter((entry) => !excluded.has(entry.id) && entry.scopes.palette),
    ...extraEntries,
  ];
  const entryIds = new Set(entries.map((entry) => entry.id));

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
    const pinned = snapshot.pins
      .filter((id) => entryIds.has(id))
      .map((id) => snapshot.entries.find((entry) => entry.id === id))
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .map(unranked);
    const pinnedIds = new Set(snapshot.pins);
    const recent = snapshot.recentIds
      .filter((id) => entryIds.has(id) && !pinnedIds.has(id))
      .map((id) => snapshot.entries.find((entry) => entry.id === id))
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .map(unranked);
    const usedIds = new Set([...snapshot.pins, ...snapshot.recentIds]);
    const suggested = SUGGESTED_IDS.filter((id) => entryIds.has(id) && !usedIds.has(id))
      .map((id) => snapshot.entries.find((entry) => entry.id === id))
      .filter((entry): entry is CommandEntry => Boolean(entry))
      .map(unranked);
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
    if (recent.length > 0) {
      sections.push({ key: 'recent', label: TEXT.COMMAND_GROUP_RECENT, items: recent });
    }
    if (suggested.length > 0) {
      sections.push({ key: 'suggested', label: TEXT.COMMAND_GROUP_SUGGESTED, items: suggested });
    }
    return { query, argv, alias, sections, total: pinned.length + recent.length + suggested.length };
  }

  const ranked = rankEntries(entries, alias, snapshot.recentIds);
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
  | { type: 'tool'; direct: { name: string; args: Record<string, unknown>; commandId: string } };

function argsForEntry(
  entry: CommandEntry,
  argv: string[],
  rawRest: string,
  defaults?: Record<string, unknown>
): Record<string, unknown> {
  const required = entry.args.filter((arg) => arg.required);
  let args: Record<string, unknown>;
  if (required.length === 1 && entry.args.length <= 1) {
    args = { [required[0]?.name ?? 'value']: rawRest };
  } else {
    args = {};
    entry.args.forEach((spec, index) => {
      const value = argv[index];
      if (value === undefined) {
        return;
      }
      if (spec.type === 'number') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          args[spec.name] = parsed;
          return;
        }
      }
      if (spec.type === 'boolean') {
        args[spec.name] = value === 'true';
        return;
      }
      args[spec.name] = value;
    });
  }
  for (const spec of entry.args) {
    const current = args[spec.name];
    if ((current === undefined || current === '') && defaults?.[spec.name] !== undefined) {
      args[spec.name] = defaults[spec.name];
    }
  }
  return args;
}

/**
 * Resolves composer input that starts with `/` against the cached
 * catalog — the single slash semantics used by both the palette and
 * direct typing (plan 14 D1: main re-validates on execute). Configured
 * argument defaults fill values the user did not type.
 */
export function resolveSlashInput(
  input: string,
  argDefaults?: Record<string, Record<string, unknown>>
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
    const args = argsForEntry(match.entry, match.argv, rawRest, argDefaults?.[match.entry.id]);
    return { type: 'tool', direct: { name: match.entry.toolName, args, commandId: match.entry.id } };
  }
  if (match.entry.kind === 'custom') {
    return { type: 'custom', entry: match.entry, argv: match.argv };
  }
  return { type: 'builtin', entry: match.entry, argv: match.argv };
}
