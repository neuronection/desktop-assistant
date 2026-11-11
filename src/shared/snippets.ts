export interface SnippetValues {
  /** Rendered date for `{date}`. */
  date: string;
  /** Clipboard text for `{clipboard}`. */
  clipboard?: string;
}

/** Expands the literal placeholders; `{cursor}` is removed (caret ends after the text). */
export function resolveSnippet(body: string, values: SnippetValues): string {
  return body
    .replaceAll('{date}', values.date)
    .replaceAll('{clipboard}', values.clipboard ?? '')
    .replaceAll('{cursor}', '');
}
