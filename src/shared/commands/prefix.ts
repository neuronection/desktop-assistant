export const PALETTE_PREFIXES = [
  { prefix: '>', kind: 'commands' },
  { prefix: '@', kind: 'apps' },
  { prefix: '=', kind: 'calc' },
  { prefix: 'g ', kind: 'web' },
] as const;

export type PalettePrefixKind = 'none' | (typeof PALETTE_PREFIXES)[number]['kind'];

export interface ParsedPalettePrefix {
  kind: PalettePrefixKind;
  /** The text after the prefix, trimmed at the start only. */
  query: string;
}

/**
 * Launcher prefix grammar: `>` commands, `@` apps, `= expression` calculator,
 * `g query` web search. `g` only counts when a space follows, so ordinary
 * words that start with g stay prose.
 */
export function parsePalettePrefix(input: string): ParsedPalettePrefix {
  const leading = input.trimStart();
  if (leading.startsWith('>')) {
    return { kind: 'commands', query: leading.slice(1).trimStart() };
  }
  if (leading.startsWith('@')) {
    return { kind: 'apps', query: leading.slice(1).trimStart() };
  }
  if (leading.startsWith('=')) {
    return { kind: 'calc', query: leading.slice(1).trimStart() };
  }
  if (/^g\s/.test(leading)) {
    return { kind: 'web', query: leading.slice(1).trimStart() };
  }
  return { kind: 'none', query: input };
}
