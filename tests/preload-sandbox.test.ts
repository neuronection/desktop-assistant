import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'preload', 'preload.generated.ts'), 'utf8');
const code = source.replace(/^\/\/[^\n]*$/gm, '');

describe('the preload stays loadable under the production sandbox (2026-11-03)', () => {
  it('imports nothing but electron', () => {
    const specifiers = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(specifiers).toEqual(['electron']);
  });

  it('loads no other module at run time', () => {
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
  });

  it('exposes the bridge exactly once', () => {
    expect(code.match(/exposeInMainWorld\(\s*'electronAPI'/g)).toHaveLength(1);
  });
});
