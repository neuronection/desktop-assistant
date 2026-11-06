import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const MARKERS = new Set(['todo', 'fixme', 'legacy', 'deprecated']);
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.cjs', '.mjs']);
const GENERATED_DIRS = new Set(['generated']);

function segments(source: string): string[] {
  const words = source.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
  return words
    .flatMap((word) =>
      word
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(' ')
    )
    .map((word) => word.toLowerCase());
}

export function markersIn(source: string): string[] {
  return [...new Set(segments(source).filter((word) => MARKERS.has(word)))];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return GENERATED_DIRS.has(entry) ? [] : walk(path);
    }
    return [path];
  });
}

describe('no-legacy marker gate (plan 37 S1)', () => {
  it('detects marker words in prose, comments and camelCase identifiers', () => {
    expect(markersIn('// TODO fix this')).toEqual(['todo']);
    expect(markersIn('const legacyStt = 1;')).toEqual(['legacy']);
    expect(markersIn('@deprecated')).toEqual(['deprecated']);
    expect(markersIn('class ApplyThemeToDOM {}')).toEqual([]);
  });

  it('src contains no TODO, FIXME, legacy or deprecated marker', () => {
    const offenders = walk(SRC)
      .filter((file) => SCANNED_EXTENSIONS.has(extname(file)))
      .filter((file) => !file.endsWith('.generated.ts'))
      .flatMap((file) =>
        markersIn(readFileSync(file, 'utf8')).map((marker) => `${relative(process.cwd(), file)}: ${marker}`)
      );
    expect(offenders).toEqual([]);
  });
});
