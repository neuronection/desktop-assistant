/**
 * FTS5 MATCH builder shared by every local FTS index (docs, memory —
 * plan 12 §5 / plan 16 S1): plain words become AND-ed prefix terms.
 * FTS5 syntax characters are dropped so user input can never inject
 * query grammar (NEAR, column filters, quoting tricks).
 */
export function buildFtsQuery(query: string, maxTerms = 12): string | null {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const meaningful = tokens.filter((token) => token.length > 1).slice(0, maxTerms);
  if (meaningful.length === 0) {
    return null;
  }
  return meaningful.map((token) => `"${token}"*`).join(' AND ');
}
