import { describe, expect, it } from 'vitest';
import { parseCommandInput, tokenizeArgs } from '@shared/commands/parse';

describe('tokenizeArgs', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('ls -la src')).toEqual(['ls', '-la', 'src']);
  });

  it('collapses repeated whitespace and trims', () => {
    expect(tokenizeArgs('  a   b  ')).toEqual(['a', 'b']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenizeArgs('')).toEqual([]);
    expect(tokenizeArgs('   ')).toEqual([]);
  });

  it('keeps single-quoted content literal including spaces', () => {
    expect(tokenizeArgs("echo 'hello   world'")).toEqual(['echo', 'hello   world']);
  });

  it('keeps double-quoted content with spaces', () => {
    expect(tokenizeArgs('git commit -m "two words"')).toEqual(['git', 'commit', '-m', 'two words']);
  });

  it('honors backslash escapes outside quotes', () => {
    expect(tokenizeArgs('a\\ b c')).toEqual(['a b', 'c']);
  });

  it('honors \\" and \\\\ escapes inside double quotes only', () => {
    expect(tokenizeArgs('"say \\"hi\\"" x')).toEqual(['say "hi"', 'x']);
    expect(tokenizeArgs('"a\\nb"')).toEqual(['a\\nb']);
  });

  it('closes unterminated quotes gracefully at end of input', () => {
    expect(tokenizeArgs("echo 'open")).toEqual(['echo', 'open']);
    expect(tokenizeArgs('echo "open')).toEqual(['echo', 'open']);
  });

  it('treats a backslash at end of input literally', () => {
    expect(tokenizeArgs('abc\\')).toEqual(['abc\\']);
  });
});

describe('parseCommandInput', () => {
  it('returns null alias when input has no slash prefix', () => {
    expect(parseCommandInput('hello world')).toEqual({ alias: null, argv: [], rest: '', raw: 'hello world' });
  });

  it('parses slash alias without args', () => {
    expect(parseCommandInput('/screenshot')).toEqual({
      alias: 'screenshot',
      argv: [],
      rest: '',
      raw: '/screenshot',
    });
  });

  it('parses slash alias with argv', () => {
    const parsed = parseCommandInput('/shell ls -la "my dir"');
    expect(parsed.alias).toBe('shell');
    expect(parsed.argv).toEqual(['ls', '-la', 'my dir']);
  });

  it('lowercases the alias and keeps argv case', () => {
    const parsed = parseCommandInput('/FILES *.MD');
    expect(parsed.alias).toBe('files');
    expect(parsed.argv).toEqual(['*.MD']);
  });

  it('normalizes whitespace around the command', () => {
    expect(parseCommandInput('   /calc   1 + 2  ').alias).toBe('calc');
  });

  it('returns null alias for a bare slash', () => {
    expect(parseCommandInput('/').alias).toBeNull();
    expect(parseCommandInput('/ ').alias).toBeNull();
  });
});
