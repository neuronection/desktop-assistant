import type { CommandEntry, CommandSource } from './types';
import { parseCommandInput } from './parse';

/**
 * Alias-shadow order (plan 14 D6): builtins (system) outrank user
 * customs, which outrank tools; everything else trails. Deterministic
 * tie-break on id so resolution is testable.
 */
const SOURCE_PRIORITY: Record<CommandSource, number> = {
  system: 0,
  user: 1,
  native: 2,
  mcp: 3,
  app: 4,
  integration: 5,
};

const normalizeAlias = (alias: string): string => alias.replace(/^\//, '').toLowerCase();

export function entryAliases(entry: CommandEntry): string[] {
  const aliases = new Set(entry.aliases.map(normalizeAlias));
  if (entry.slash) {
    aliases.add(normalizeAlias(entry.slash));
  }
  return [...aliases];
}

function paletteResolvable(entry: CommandEntry): boolean {
  return entry.scopes.palette && entryAliases(entry).length > 0;
}

export function sortedAliasEntries(entries: CommandEntry[]): CommandEntry[] {
  return entries
    .filter(paletteResolvable)
    .sort(
      (a, b) =>
        SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] || a.id.localeCompare(b.id)
    );
}

export interface AliasMatch {
  entry: CommandEntry;
  argv: string[];
}

/** Exact alias resolution over the whole catalog (fuzzy ranking is the renderer's job). */
export function resolveCommandAlias(entries: CommandEntry[], input: string): AliasMatch | null {
  const parsed = parseCommandInput(input);
  if (!parsed.alias) {
    return null;
  }
  for (const entry of sortedAliasEntries(entries)) {
    if (entryAliases(entry).includes(parsed.alias)) {
      return { entry, argv: parsed.argv };
    }
  }
  return null;
}
