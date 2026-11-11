import { describe, expect, it } from 'vitest';
import { resolveSnippet, snippetCursor } from '@shared/snippets';

describe('resolveSnippet', () => {
  it('expands date and clipboard and removes the cursor marker', () => {
    expect(
      resolveSnippet('On {date}: {clipboard}{cursor}', { date: '11/11/2026', clipboard: 'copied' })
    ).toBe('On 11/11/2026: copied');
  });

  it('does not expand tokens inside clipboard content', () => {
    expect(resolveSnippet('{clipboard}', { date: 'x', clipboard: 'keep {cursor}' })).toBe('keep {cursor}');
  });

  it('reports the caret offset where the marker was', () => {
    expect(snippetCursor('Hi {date}{cursor} there', { date: 'X' })).toBe(4);
    expect(snippetCursor('no marker', { date: 'X' })).toBeNull();
  });

  it('leaves unknown braces alone', () => {
    expect(resolveSnippet('keep {other}', { date: 'x' })).toBe('keep {other}');
  });
});
