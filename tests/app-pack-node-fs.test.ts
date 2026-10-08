import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodePackFsDeps } from '@main/apps/capabilities/node-fs';
import { validateRunRoot, walkPackRoot, newScanBudget, PackFs, type PackFsEnv } from '@main/apps/capabilities/fs';

let root: string;

beforeAll(() => {
  const base = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, 'pack-fs-adapter-'));
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'plain.txt'), 'hello world');
  writeFileSync(join(root, 'sub', 'deep.log'), 'x'.repeat(50));
  try {
    symlinkSync(join(root, 'plain.txt'), join(root, 'link.txt'));
  } catch {
    // symlink creation may be unavailable on some CI runners; the walk test tolerates it
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ENV: PackFsEnv = { home: '/home/tester', userData: '/home/tester/.config/da', platform: 'linux' };

describe('nodePackFsDeps (real fs, repo-local temp dir only)', () => {
  it('refuses the system tmp tree as a run root (contract rule) before touching it', async () => {
    const refused = await validateRunRoot(join(tmpdir(), 'some-scan'), ENV, nodePackFsDeps);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('path-denied');
    }
  });

  it('validates the temp root and walks it with the production adapter', async () => {
    const validated = await validateRunRoot(root, ENV, nodePackFsDeps);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const items: string[] = [];
    await walkPackRoot(
      validated.value.root,
      { includeHidden: false, excludeGlobs: [], fileCap: 100, maxDepth: 16, rootDev: validated.value.dev },
      nodePackFsDeps,
      newScanBudget(),
      async (item) => {
        items.push(item.relative);
      }
    );
    expect(items).toContain('plain.txt');
    expect(items).toContain('sub/deep.log');
    expect(items.some((item) => item === 'link.txt')).toBe(false);
  });

  it('reads a capped excerpt through PackFs against the real file', async () => {
    const validated = await validateRunRoot(root, ENV, nodePackFsDeps);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    const fs = new PackFs(validated.value.root, validated.value.dev, nodePackFsDeps);
    const excerpt = await fs.readExcerpt('sub/deep.log', 10);
    expect(excerpt.ok).toBe(true);
    if (excerpt.ok) {
      expect(excerpt.value.buffer.length).toBe(10);
      expect(excerpt.value.truncated).toBe(true);
    }
    const escaped = await fs.readExcerpt('../plain.txt', 10);
    expect(escaped.ok).toBe(false);
  });
});
