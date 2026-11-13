/**
 * Turns an assistant markdown reply into something worth speaking
 * (plan 12 §6): code blocks drop entirely, inline markup unwraps,
 * links speak their label, lists speak their text.
 */
export function speechTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/\|/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\({1,2}https?:\/\/\S+?\){1,2}/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Markdown → display text for the HUD (plan 82 follow-up). Unlike
 * `speechTextFromMarkdown` it keeps links, URLs, emoji and identifiers (they are
 * visible content), and only removes the formatting scaffolding: fences,
 * headings, quotes, list markers, emphasis, table rules and horizontal rules.
 */
export function plainTextFromMarkdown(markdown: string): string {
  const stripped = markdown
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__|~~)/g, '')
    // Emphasis only when the delimiter is not inside a word, so snake_case and
    // file_name survive (the Unicode class also protects Greek/Cyrillic words).
    .replace(/(?<![\p{L}\p{N}])([*_])(\S(?:[^*_\n]*?\S)?)\1(?![\p{L}\p{N}])/gu, '$2');

  return stripped
    .split('\n')
    .map((line) => line.trim())
    // Table separator rows (`| --- | :--: |`) and horizontal rules are noise.
    .filter((line) => !/^(?:\|?\s*:?-{3,}:?\s*)+\|?$/.test(line) && !/^(?:[-*_]\s*){3,}$/.test(line))
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .join('\n');
}
