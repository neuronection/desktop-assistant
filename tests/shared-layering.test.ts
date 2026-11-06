import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SHARED = join(process.cwd(), 'src', 'shared');
const MAIN_IMPORT = /(?:from\s+['"]|require\(\s*['"])@main(?:\/|['"])/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return walk(path);
    }
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe('shared layering (plan 45 S1)', () => {
  it('src/shared never imports src/main', () => {
    const offenders = walk(SHARED)
      .filter((file) => MAIN_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it('the PDF strategy type lives in shared, not the main service', () => {
    const types = readFileSync(join(SHARED, 'types.ts'), 'utf8');
    const attachment = readFileSync(join(process.cwd(), 'src/main/services/AttachmentService.ts'), 'utf8');
    expect(types).toContain("export type PdfProcessingStrategy = 'extractText';");
    expect(types).not.toContain('@main/services/AttachmentService');
    expect(attachment).not.toContain('export type PdfProcessingStrategy');
    expect(attachment).toContain("from '@shared/types'");
  });
});
