import { describe, expect, it } from 'vitest';
import { resolveSnippet } from '@shared/snippets';

describe('resolveSnippet', () => {
  it('expands date and clipboard and removes the cursor marker', () => {
    expect(
      resolveSnippet('On {date}: {clipboard}{cursor}', { date: '11/11/2026', clipboard: 'copied' })
    ).toBe('On 11/11/2026: copied');
  });

  it('leaves unknown braces alone', () => {
    expect(resolveSnippet('keep {other}', { date: 'x' })).toBe('keep {other}');
  });
});
