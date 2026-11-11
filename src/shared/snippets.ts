export interface SnippetValues {
  /** Rendered date for `{date}`. */
  date: string;
  /** Clipboard text for `{clipboard}`. */
  clipboard?: string;
}

/** Expands the literal placeholders; `{cursor}` is removed (caret ends after the text). */
export function resolveSnippet(body: string, values: SnippetValues): string {
  return body.replace(/\{(date|clipboard|cursor)\}/g, (_match, key: 'date' | 'clipboard' | 'cursor') => {
    if (key === 'date') {
      return values.date;
    }
    if (key === 'clipboard') {
      return values.clipboard ?? '';
    }
    return '';
  });
}

/** Character offset where `{cursor}` sat, expressed in the resolved text. */
export function snippetCursor(body: string, values: SnippetValues): number | null {
  const marker = body.indexOf('{cursor}');
  return marker === -1 ? null : resolveSnippet(body.slice(0, marker), values).length;
}
