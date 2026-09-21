/**
 * App-context digests (plan 23 S3, D4/D10/D13): compact, capped renders
 * of an app's live state (e.g. Home Assistant entities) injected into
 * prompts so models never spend tool calls on discovery. Pure math —
 * the fetch/single-flight/TTL lives in the main-process digest service.
 */

export const APP_CONTEXT_MAX_ROWS = 150;
export const APP_CONTEXT_MAX_CHARS = 1200;

export interface DigestRow {
  id: string;
  label: string;
}

/** Render one app's digest block; `ageMinutes` present only when stale. */
export function renderAppDigest(
  appName: string,
  rows: DigestRow[],
  ageMinutes?: number
): string | null {
  if (rows.length === 0) {
    return null;
  }
  const capped = rows.slice(0, APP_CONTEXT_MAX_ROWS);
  const header = ageMinutes === undefined ? `[App context — ${appName}]` : `[App context — ${appName} · ${ageMinutes} min old]`;
  const lines: string[] = [];
  let total = header.length;
  for (const row of capped) {
    const line = `- ${row.id} — ${row.label}`;
    if (total + line.length > APP_CONTEXT_MAX_CHARS) {
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  if (lines.length === 0) {
    return null;
  }
  if (capped.length < rows.length) {
    lines.push(`(+${rows.length - capped.length} more not listed)`);
  }
  return `${header}\n${lines.join('\n')}`;
}
