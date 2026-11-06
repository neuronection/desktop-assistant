import { describe, it, expect } from 'vitest';
import { completeWordUnits, findBlockBoundaries } from '@shared/text/segment';

describe('completeWordUnits', () => {
  it('buffers sub-token fragments until a Greek word completes', () => {
    expect(completeWordUnits('Καλη')).toEqual({ complete: [], rest: 'Καλη' });
    expect(completeWordUnits('Καλημέρα ').complete).toEqual(['Καλημέρα ']);
    expect(completeWordUnits('Καλημέρα σε όλους! ').complete).toEqual(['Καλημέρα ', 'σε ', 'όλους! ']);
    expect(completeWordUnits('Καλημέρα σε όλους!').rest).toBe('όλους!');
  });

  it('keeps accented words and combining marks intact', () => {
    const scan = completeWordUnits('άνθρωποι και ήρεμοι ');
    expect(scan.complete).toEqual(['άνθρωποι ', 'και ', 'ήρεμοι ']);
  });

  it('treats punctuation runs and emoji as their own units', () => {
    expect(completeWordUnits('... ναι! 🎉 ').complete).toEqual(['... ', 'ναι! ', '🎉 ']);
  });

  it('never splits runs into single letters (CJK and Latin)', () => {
    expect(completeWordUnits('你好世界 です ').complete).toEqual(['你好世界 ', 'です ']);
    expect(completeWordUnits('你好').rest).toBe('你好');
    expect(completeWordUnits('useChatStream ').complete).toEqual(['useChatStream ']);
  });

  it('buffers leading whitespace runs instead of dropping them', () => {
    expect(completeWordUnits('\n\nΓεια ')).toEqual({ complete: ['\n\n', 'Γεια '], rest: '' });
  });

  it('attaches newlines to the preceding unit', () => {
    expect(completeWordUnits('πρώτη παράγραφος\n\n').complete).toEqual(['πρώτη ', 'παράγραφος\n\n']);
  });
});

describe('findBlockBoundaries', () => {
  it('settles a paragraph at a blank line', () => {
    expect(findBlockBoundaries('para one\n\npara two')).toEqual([10]);
  });

  it('settles before a fence opens and after it closes, never inside', () => {
    const text = 'text\n```py\nline\n\nmore\n```\nafter';
    expect(findBlockBoundaries(text)).toEqual([5, 26]);
    expect(text.slice(5, 26)).toBe('```py\nline\n\nmore\n```\n');
  });

  it('never settles a fence whose close line may still grow', () => {
    expect(findBlockBoundaries('```py\nline\n\nmore\n```')).toEqual([]);
    expect(findBlockBoundaries('```py\nline\n\nmore\n```\n')).toEqual([21]);
  });

  it('settles a heading at its line end and lets it interrupt a paragraph', () => {
    expect(findBlockBoundaries('para\n# Head\nbody')).toEqual([5, 12]);
    expect(findBlockBoundaries('## ')).toEqual([]);
  });

  it('settles list items one by one at CommonMark block starts', () => {
    expect(findBlockBoundaries('- a\n- b\n- c')).toEqual([4, 8]);
  });

  it('keeps a bullet inside a paragraph but lets an ordered 1 and a quote interrupt', () => {
    expect(findBlockBoundaries('para\n- x')).toEqual([]);
    expect(findBlockBoundaries('para\n2. x')).toEqual([]);
    expect(findBlockBoundaries('para\n1. x')).toEqual([5]);
    expect(findBlockBoundaries('para\n> q')).toEqual([5]);
  });

  it('never settles a blank-looking final line that may still grow', () => {
    expect(findBlockBoundaries('para\n ')).toEqual([]);
    expect(findBlockBoundaries('para\n\n')).toEqual([6]);
  });

  it('settles a math block at its close', () => {
    expect(findBlockBoundaries('a\n\n$$\nx\n$$\nb')).toEqual([3, 11]);
  });

  it('returns nothing while a block is still open', () => {
    expect(findBlockBoundaries('one line\nanother line')).toEqual([]);
    expect(findBlockBoundaries('```py\ngrowing code')).toEqual([]);
  });

  it('treats inline math as plain block content', () => {
    expect(findBlockBoundaries('text with $$x$$ inline')).toEqual([]);
  });
});
