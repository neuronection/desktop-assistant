import { describe, it, expect } from 'vitest';
import { splitSpeechChunks } from '@renderer/chat-react/speechChunks';

describe('splitSpeechChunks (plan 25 D8)', () => {
  it('returns nothing for empty text', () => {
    expect(splitSpeechChunks('   ')).toEqual([]);
  });

  it('groups short sentences into one chunk', () => {
    expect(splitSpeechChunks('Hello there. How are you?', 300)).toEqual(['Hello there. How are you?']);
  });

  it('splits when the group would exceed the limit', () => {
    const text = `${'A'.repeat(200)}. ${'B'.repeat(200)}.`;
    const chunks = splitSpeechChunks(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 300)).toBe(true);
  });

  it('hard-splits a single over-long sentence at a word boundary', () => {
    const chunks = splitSpeechChunks(`${'word '.repeat(80)}end.`, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
  });

  it('does not split decimals or lowercase continuations', () => {
    expect(splitSpeechChunks('Pi is 3.14 exactly.')).toEqual(['Pi is 3.14 exactly.']);
    expect(splitSpeechChunks('Use e.g. this one.')).toEqual(['Use e.g. this one.']);
  });
});
