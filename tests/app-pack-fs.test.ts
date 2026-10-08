import { describe, expect, it } from 'vitest';
import { join } from 'path';
import {
  isLexicallySafeRelative,
  joinWithinRoot,
  validateRunRoot,
  walkPackRoot,
  newScanBudget,
  PackFs,
  type PackDirEntry,
  type PackFsDeps,
  type PackFsEnv,
  type PackStat,
} from '@main/apps/capabilities/fs';

interface FakeNode {
  kind: 'file' | 'dir' | 'symlink' | 'socket';
  dev?: number;
  size?: number;
  mtimeMs?: number;
  target?: string;
  children?: Record<string, FakeNode>;
}

function file(overrides: Partial<FakeNode> = {}): FakeNode {
  return { kind: 'file', size: 10, mtimeMs: 1000, ...overrides };
}

function dir(children: Record<string, FakeNode> = {}, overrides: Partial<FakeNode> = {}): FakeNode {
  return { kind: 'dir', children, ...overrides };
}

class FakeFs implements PackFsDeps {
  constructor(private readonly tree: Record<string, FakeNode>, private readonly roots: Record<string, string> = {}) {}

  private lookup(path: string): FakeNode | null {
    const resolved = this.roots[path] ?? path;
    let node: FakeNode = { kind: 'dir', children: this.tree };
    if (resolved === '' || resolved === '/') {
      return node;
    }
    for (const segment of resolved.split('/').filter(Boolean)) {
      if (node.kind !== 'dir') {
        return null;
      }
      const next = node.children?.[segment];
      if (!next) {
        return null;
      }
      node = next;
    }
    return node;
  }

  async realpath(path: string): Promise<string> {
    let node = this.lookup(path);
    let current = path;
    const seen = new Set<string>();
    while (node?.kind === 'symlink') {
      if (seen.has(current)) {
        throw new Error('symlink loop');
      }
      seen.add(current);
      current = node.target ?? '/';
      node = this.lookup(current);
    }
    if (!node) {
      throw new Error(`ENOENT ${path}`);
    }
    return current;
  }

  private stats(node: FakeNode, path: string): PackStat {
    if (node.kind === 'symlink') {
      return { isFile: false, isDirectory: false, isSymbolicLink: true, dev: 1, size: 0, mtimeMs: 0 };
    }
    return {
      isFile: node.kind === 'file',
      isDirectory: node.kind === 'dir',
      isSymbolicLink: false,
      dev: node.dev ?? 1,
      size: node.size ?? 0,
      mtimeMs: node.mtimeMs ?? 0,
    };
  }

  async stat(path: string): Promise<PackStat> {
    const node = await this.realpath(path).then((real) => this.lookup(real));
    if (!node || node.kind === 'symlink') {
      throw new Error(`ENOENT ${path}`);
    }
    return this.stats(node, path);
  }

  async readdir(path: string): Promise<PackDirEntry[]> {
    const node = await this.realpath(path).then((real) => this.lookup(real));
    if (!node || node.kind !== 'dir') {
      throw new Error(`ENOTDIR ${path}`);
    }
    return Object.entries(node.children ?? {}).map(([name, child]) => ({
      name,
      isFile: child.kind === 'file',
      isDirectory: child.kind === 'dir',
      isSymbolicLink: child.kind === 'symlink',
    }));
  }

  async readFileHead(path: string, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
    const node = await this.realpath(path).then((real) => this.lookup(real));
    if (!node || node.kind !== 'file') {
      throw new Error(`ENOENT ${path}`);
    }
    const content = Buffer.alloc(node.size ?? 0, 0x61);
    return { buffer: content.subarray(0, maxBytes), truncated: content.length > maxBytes };
  }
}

const ENV: PackFsEnv = { home: '/home/tester', userData: '/home/tester/.config/desktop-assistant', platform: 'linux' };

describe('fs root validation — broad and system roots refused', () => {
  it('refuses /, home itself, userData, mount parents and drive roots', async () => {
    const tree: Record<string, FakeNode> = {
      home: dir({ tester: dir({ '.config': dir({ 'desktop-assistant': dir() }) }) }),
      mnt: dir({ data: dir() }),
      media: dir({ usb: dir() }),
    };
    const deps = new FakeFs(tree);
    for (const root of ['/', '/home/tester', '/home/tester/.config/desktop-assistant', '/mnt', '/media', '/mnt/data/..']) {
      const result = await validateRunRoot(root, ENV, deps);
      expect(result.ok, root).toBe(false);
      if (!result.ok) {
        expect(result.error.code, root).toBe('path-denied');
      }
    }
    const windowsEnv: PackFsEnv = { ...ENV, platform: 'win32' };
    const drive = await validateRunRoot('C:\\', windowsEnv, new FakeFs({}));
    expect(drive.ok).toBe(false);
  });

  it('refuses system trees by prefix', async () => {
    const tree: Record<string, FakeNode> = { usr: dir({ share: dir() }), proc: dir({ self: dir() }) };
    const deps = new FakeFs(tree);
    for (const root of ['/usr', '/usr/share', '/proc', '/proc/self']) {
      const result = await validateRunRoot(root, ENV, deps);
      expect(result.ok, root).toBe(false);
    }
  });

  it('refuses non-directories and missing paths (io), and lexically unsafe roots', async () => {
    const tree: Record<string, FakeNode> = { afile: file() };
    const deps = new FakeFs(tree);
    const notDir = await validateRunRoot('/afile', ENV, deps);
    expect(notDir.ok).toBe(false);
    if (!notDir.ok) {
      expect(notDir.error.code).toBe('path-denied');
    }
    const missing = await validateRunRoot('/nope', ENV, deps);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe('io');
    }
    const traversal = await validateRunRoot('/home/tester/projects/../..', ENV, deps);
    expect(traversal.ok).toBe(false);
  });

  it('resolves a symlinked root to its real path and vets THAT', async () => {
    const tree: Record<string, FakeNode> = {
      usr: dir({ share: dir({ data: dir() }) }),
      home: dir({
        tester: dir({
          link: { kind: 'symlink', target: '/usr/share/data' },
          projects: dir({ ok: dir() }),
        }),
      }),
    };
    const deps = new FakeFs(tree);
    const escaped = await validateRunRoot('/home/tester/link', ENV, deps);
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) {
      expect(escaped.error.code).toBe('path-denied');
    }
    const legit = await validateRunRoot('/home/tester/projects/ok', ENV, deps);
    expect(legit.ok).toBe(true);
  });
});

describe('fs lexical containment', () => {
  it('refuses traversal, absolute injection, NUL and empty relative paths', () => {
    expect(joinWithinRoot('/root', 'a/b.txt')).toBe(join('/root', 'a', 'b.txt'));
    expect(joinWithinRoot('/root', '../escape')).toBeNull();
    expect(joinWithinRoot('/root', 'a/../../escape')).toBeNull();
    expect(joinWithinRoot('/root', '/etc/passwd')).toBeNull();
    expect(joinWithinRoot('/root', 'a\0b')).toBeNull();
    expect(joinWithinRoot('/root', '')).toBeNull();
    expect(isLexicallySafeRelative('a/b')).toBe(true);
    expect(isLexicallySafeRelative('..')).toBe(false);
  });
});

describe('fs scan traversal — the escape matrix', () => {
  const TREE: Record<string, FakeNode> = {
    root: dir({
      plain: file({ size: 5 }),
      '.hidden': file(),
      'sym.txt': { kind: 'symlink', target: '/etc/passwd' },
      sock: { kind: 'socket' },
      sub: dir({ deep: file({ size: 7 }) }),
      mount: dir({ inside: file() }, { dev: 99 }),
      '.hiddendir': dir({ nested: file() }),
    }),
  };

  async function collect(options: Partial<Parameters<typeof walkPackRoot>[1]>) {
    const items: string[] = [];
    const deps = new FakeFs(TREE);
    const stat = await deps.stat('/root');
    await walkPackRoot(
      '/root',
      {
        includeHidden: false,
        excludeGlobs: [],
        fileCap: 100,
        maxDepth: 16,
        rootDev: stat.dev,
        ...options,
      },
      deps,
      newScanBudget(),
      async (item) => {
        items.push(item.relative);
      }
    );
    return items;
  }

  it('yields regular files only — symlinks and special files never become items', async () => {
    const items = await collect({});
    expect(items).toContain('plain');
    expect(items).toContain('sub/deep');
    expect(items.some((item) => item.includes('sym'))).toBe(false);
    expect(items.some((item) => item.includes('sock'))).toBe(false);
  });

  it('skips hidden entries unless includeHidden, honors excludeGlobs', async () => {
    expect((await collect({})).some((item) => item.startsWith('.hidden'))).toBe(false);
    expect((await collect({ includeHidden: true })).some((item) => item.startsWith('.hidden'))).toBe(true);
    expect((await collect({ excludeGlobs: ['sub/**'] })).some((item) => item.startsWith('sub/'))).toBe(false);
    expect((await collect({ excludeGlobs: ['*.txt'] })).some((item) => item.endsWith('.txt'))).toBe(false);
  });

  it('skips mount points (st_dev change) entirely', async () => {
    const items = await collect({});
    expect(items.some((item) => item.startsWith('mount/'))).toBe(false);
  });

  it('caps files and depth, marking the budget truncated', async () => {
    const items: string[] = [];
    const deps = new FakeFs(TREE);
    const stat = await deps.stat('/root');
    const budget = newScanBudget();
    await walkPackRoot('/root', { includeHidden: false, excludeGlobs: [], fileCap: 1, maxDepth: 16, rootDev: stat.dev }, deps, budget, async (item) => {
      items.push(item.relative);
    });
    expect(budget.truncated).toBe(true);
    expect(items.length).toBeLessThanOrEqual(1);
    const deep: string[] = [];
    await walkPackRoot('/root', { includeHidden: false, excludeGlobs: [], fileCap: 100, maxDepth: 1, rootDev: stat.dev }, deps, newScanBudget(), async (item) => {
      deep.push(item.relative);
    });
    expect(deep.some((item) => item === 'sub/deep')).toBe(false);
  });
});

describe('PackFs — per-call revalidation', () => {
  function makeFs(tree: Record<string, FakeNode>, roots: Record<string, string> = {}): { fs: PackFs; deps: FakeFs } {
    const deps = new FakeFs(tree, roots);
    return { fs: new PackFs('/root', 1, deps), deps };
  }

  it('readExcerpt clamps the cap and reports truncation', async () => {
    const tree: Record<string, FakeNode> = { root: dir({ big: file({ size: 100_000 }) }) };
    const { fs } = makeFs(tree);
    const result = await fs.readExcerpt('big', 8192);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.buffer.length).toBe(8192);
      expect(result.value.truncated).toBe(true);
    }
  });

  it('readExcerpt refuses a symlink swapped in under a safe-looking path', async () => {
    const tree: Record<string, FakeNode> = {
      root: dir({ swapped: { kind: 'symlink', target: '/etc/passwd' } }),
      etc: dir({ passwd: file() }),
    };
    const { fs } = makeFs(tree);
    const result = await fs.readExcerpt('swapped', 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('path-denied');
    }
  });

  it('readExcerpt refuses cross-device paths and non-files', async () => {
    const tree: Record<string, FakeNode> = {
      root: dir({
        other: file({ dev: 42 }),
        sub: dir({}),
      }),
    };
    const { fs } = makeFs(tree);
    const crossDevice = await fs.readExcerpt('other', 10);
    expect(crossDevice.ok).toBe(false);
    if (!crossDevice.ok) {
      expect(crossDevice.error.code).toBe('path-denied');
    }
    const notFile = await fs.statItem('sub');
    expect(notFile.ok).toBe(true);
  });
});
