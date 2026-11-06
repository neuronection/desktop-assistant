import { describe, it, expect } from 'vitest';
import { streamTailKeepsWhitespace } from '@renderer/chat-react/streamDisplay/tailFormat';

describe('streamTailKeepsWhitespace', () => {
  it('collapses soft line breaks in prose like the final markdown renderer', () => {
    expect(streamTailKeepsWhitespace('Μα ένα βράδυ,\nόσο κι αν γύρισε τον διακόπτη.')).toBe(false);
    expect(streamTailKeepsWhitespace('μια γραμμή\n\nάλλη γραμμή')).toBe(false);
  });

  it('keeps whitespace inside an open fenced code block', () => {
    expect(streamTailKeepsWhitespace('```ts\nconst a = 1;\n  const b = 2;')).toBe(true);
    expect(streamTailKeepsWhitespace('~~~\ncode')).toBe(true);
  });

  it('returns to prose whitespace once the fence has closed', () => {
    expect(streamTailKeepsWhitespace('```\ncode\n```\ntext')).toBe(false);
  });

  it('keeps whitespace inside an open math block', () => {
    expect(streamTailKeepsWhitespace('$$\nx = y\n')).toBe(true);
    expect(streamTailKeepsWhitespace('$$x = y$$')).toBe(false);
  });
});
