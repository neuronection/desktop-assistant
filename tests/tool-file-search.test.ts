import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { findFilesTool, grepFilesTool, globToRegex } from '@main/ai/tools/native/file-search';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-filesearch-'));
  await mkdir(join(root, 'src', 'deep'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, 'notes.txt'), 'hello world\nSECOND LINE upper\n', 'utf-8');
  await writeFile(join(root, 'report-2024.md'), '# Report\nThe deploy key is abc-123.\n', 'utf-8');
  await writeFile(join(root, 'src', 'app.ts'), 'export const answer = 42;\n// TODO: refactor\n', 'utf-8');
  await writeFile(join(root, 'src', 'deep', 'util.test.ts'), 'test("math", () => {});\n', 'utf-8');
  await writeFile(join(root, 'src', 'data.json'), '{"a": 1}\n', 'utf-8');
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'dep\n', 'utf-8');
  await writeFile(join(root, '.git', 'config'), '[core]\n', 'utf-8');
  await writeFile(join(root, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 'binary'.charCodeAt(0)]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (grantedRoots: string[]) => ({ grantedRoots });

describe('globToRegex', () => {
  it('translates *, ** and ? with escaping', () => {
    expect(globToRegex('*.ts').test('a/b/c.ts')).toBe(false);
    expect(globToRegex('*.ts').test('c.ts')).toBe(true);
    expect(globToRegex('src/**/*.json').test('src/deep/data.json')).toBe(true);
    expect(globToRegex('src/**/*.json').test('src/data.json')).toBe(true);
    expect(globToRegex('**/*.ts').test('a/b/c.ts')).toBe(true);
    expect(globToRegex('report-?024.md').test('report-2024.md')).toBe(true);
    expect(globToRegex('a+b.ts').test('a+b.ts')).toBe(true);
    expect(globToRegex('a+b.ts').test('ab.ts')).toBe(false);
  });
});

describe('find_files', () => {
  it('finds by basename glob across granted roots and skips dependency folders', async () => {
    const out = await findFilesTool.exec({ pattern: '*.ts' }, ctx([root]));
    expect(out).toContain('2 match');
    expect(out).toContain(join(root, 'src', 'app.ts'));
    expect(out).toContain(join(root, 'src', 'deep', 'util.test.ts'));
    expect(out).not.toContain('node_modules');
  });

  it('matches nested globs containing slashes', async () => {
    const out = await findFilesTool.exec({ pattern: 'src/**/*.json' }, ctx([root]));
    expect(out).toContain('data.json');
  });

  it('narrowing to a root outside the granted roots is refused', async () => {
    const out = await findFilesTool.exec({ pattern: '*.txt', root: '/etc' }, ctx([root]));
    expect(out).toContain('Error:');
    expect(out).toContain('was not granted');
  });

  it('searching without any granted roots explains the setup step', async () => {
    const out = await findFilesTool.exec({ pattern: '*.txt' }, ctx([]));
    expect(out).toContain('no granted folder');
  });

  it('honours the limit', async () => {
    const out = await findFilesTool.exec({ pattern: '*.ts', limit: 1 }, ctx([root]));
    expect(out).toContain('1 match');
  });

  it('reports empty results', async () => {
    const out = await findFilesTool.exec({ pattern: '*.nonexistent' }, ctx([root]));
    expect(out).toContain('No matches');
  });

  it('never follows symlinks that escape the granted root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'da-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'top secret', 'utf-8');
      await symlink(join(outside), join(root, 'linked'), 'dir');
      const out = await findFilesTool.exec({ pattern: '**/*.txt' }, ctx([root]));
      expect(out).not.toContain('secret.txt');
      expect(out).not.toContain('linked');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('grep_files', () => {
  it('matches content case-insensitively by default with line numbers', async () => {
    const out = await grepFilesTool.exec({ pattern: 'second line' }, ctx([root]));
    expect(out).toContain('1 matching line');
    expect(out).toContain(join(root, 'notes.txt'));
    expect(out).toContain('2: SECOND LINE upper');
  });

  it('respects caseSensitive', async () => {
    const out = await grepFilesTool.exec({ pattern: 'second line', caseSensitive: true }, ctx([root]));
    expect(out).toContain('No matches');
  });

  it('filters files by glob', async () => {
    const out = await grepFilesTool.exec({ pattern: /report|hello/.source, glob: '*.md' }, ctx([root]));
    expect(out).toContain('report-2024.md');
    expect(out).not.toContain('notes.txt');
  });

  it('skips binary files', async () => {
    const out = await grepFilesTool.exec({ pattern: 'binary' }, ctx([root]));
    expect(out).toContain('No matches');
  });

  it('rejects invalid regular expressions', async () => {
    const out = await grepFilesTool.exec({ pattern: '(' }, ctx([root]));
    expect(out).toContain('invalid regular expression');
  });

  it('refuses roots outside the grant and empty grants', async () => {
    const outside = await grepFilesTool.exec({ pattern: 'x', root: '/etc' }, ctx([root]));
    expect(outside).toContain('was not granted');
    const none = await grepFilesTool.exec({ pattern: 'x' }, ctx([]));
    expect(none).toContain('no granted folder');
  });

  it('honours the match limit', async () => {
    const out = await grepFilesTool.exec({ pattern: '.', limit: 2 }, ctx([root]));
    expect(out).toContain('2 matching line');
  });
});
