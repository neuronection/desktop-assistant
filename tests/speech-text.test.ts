import { describe, it, expect } from 'vitest';
import { speechTextFromMarkdown } from '@renderer/chat-react/speechText';

describe('speechTextFromMarkdown', () => {
  it('drops fenced code entirely and unwraps inline code', () => {
    const text = speechTextFromMarkdown('Here you go:\n```bash\nnpm run deploy --force\n```\nRun `npm run verify` first.');
    expect(text).toContain('Here you go');
    expect(text).not.toContain('deploy --force');
    expect(text).toContain('Run npm run verify first');
  });

  it('speaks link labels, not URLs, and drops images', () => {
    const text = speechTextFromMarkdown('See [the runbook](https://example.com/runbook) and ![logo](https://x.com/logo.png).');
    expect(text).toContain('See the runbook and');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('logo.png');
  });

  it('strips headers, lists, emphasis and table pipes', () => {
    const text = speechTextFromMarkdown('## Headline\n- **bold** item\n1. _first_\n| a | b |\n|---|---|');
    expect(text).toContain('Headline');
    expect(text).toContain('bold item');
    expect(text).toContain('first');
    expect(text).not.toContain('#');
    expect(text).not.toContain('|');
    expect(text).not.toContain('**');
  });

  it('drops bare URLs and emoji noise, and trims whitespace runs', () => {
    const text = speechTextFromMarkdown('Check https://example.com/x  \n\n🎉 done ✅');
    expect(text).toBe('Check done');
  });

  it('returns an empty string for code-only replies (nothing worth speaking)', () => {
    expect(speechTextFromMarkdown('```\nselect 1;\n```')).toBe('');
  });
});
