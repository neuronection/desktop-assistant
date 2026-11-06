import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const ALLOWED = join('src', 'main', 'services', 'NotificationService.ts');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('one notification creator (plan 42 S1)', () => {
  it('no direct `new Notification(` outside NotificationService', () => {
    const offenders = walk(SRC)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => /new\s+Notification\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file))
      .filter((file) => file !== ALLOWED);
    expect(offenders).toEqual([]);
  });
});
