import { describe, expect, it } from 'vitest';
import { plainTextFromMarkdown } from '@renderer/chat-react/speechText';

describe('HUD display text', () => {
  it('removes markdown scaffolding but keeps the words', () => {
    expect(plainTextFromMarkdown('**Hello** and _world_')).toBe('Hello and world');
    expect(plainTextFromMarkdown('## Title\n- one\n- two')).toBe('Title\none\ntwo');
    expect(plainTextFromMarkdown('> quoted\n\n`code` here')).toBe('quoted\ncode here');
    expect(plainTextFromMarkdown('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(plainTextFromMarkdown('[docs](https://example.com) said')).toBe('docs said');
    expect(plainTextFromMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')).toBe('a b\n1 2');
  });

  it('keeps URLs, emoji and snake_case identifiers', () => {
    expect(plainTextFromMarkdown('see https://example.com/x 🎉')).toBe('see https://example.com/x 🎉');
    expect(plainTextFromMarkdown('call snake_case_name now')).toBe('call snake_case_name now');
    expect(plainTextFromMarkdown('Αυτά είναι **ό,τι** μας κρίνει.')).toBe('Αυτά είναι ό,τι μας κρίνει.');
  });
});
