/**
 * Legacy `/open <url | path | app>` smart dispatch — keeps the
 * pre-palette muscle memory working until the §5 preset pack absorbs
 * it as a user-editable preset.
 */
export interface OpenTarget {
  name: 'open_url' | 'open_path' | 'open_app';
  args: Record<string, unknown>;
}

function looksLikePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('~') || value.startsWith('./') || /^\w:[\\/]/.test(value);
}

export function resolveOpenTarget(rest: string): OpenTarget | null {
  const trimmed = rest.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { name: 'open_url', args: { url: trimmed } };
  }
  if (looksLikePath(trimmed)) {
    return { name: 'open_path', args: { path: trimmed } };
  }
  return { name: 'open_app', args: { name: trimmed.split(/\s+/)[0] ?? trimmed } };
}

export const OPEN_DISPATCH_ALIAS = 'open';
