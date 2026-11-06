import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { splitSpeechChunks } from '@shared/text/speech-chunks';

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

  it('splits Greek sentences at Greek capitals (plan 56 S1 regression)', () => {
    expect(splitSpeechChunks('Πρώτη πρόταση. Δεύτερη πρόταση.', 25)).toEqual([
      'Πρώτη πρόταση.',
      'Δεύτερη πρόταση.',
    ]);
    expect(splitSpeechChunks('Τέλος. Άλλη πρόταση.', 15)).toEqual(['Τέλος.', 'Άλλη πρόταση.']);
  });

  it('splits after the Greek question mark (U+037E)', () => {
    expect(splitSpeechChunks('Σίγουρα\u037E Ναι βέβαια.', 15)).toEqual(['Σίγουρα\u037E', 'Ναι βέβαια.']);
  });

  it('has exactly one home — the shared module both processes import', () => {
    expect(existsSync(join(process.cwd(), 'src/shared/text/speech-chunks.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'src/renderer/chat-react/speechChunks.ts'))).toBe(false);
  });
});
