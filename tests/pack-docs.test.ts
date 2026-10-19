import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { landingFile, packDocPage, packDocs, packDocsDir, stripRawHtml } from '@main/apps/docs';
import type { InstalledMiniApp } from '@main/apps/registry';

/**
 * The pack-docs watchdog (plan 34 wave 8): only tree-listed pages of a
 * VALIDATED tree are readable, every read is containment-checked inside
 * the pack's docs dir, and the raw-HTML markdown law holds on the served
 * page. A pack without the docs pointer answers with honest absence.
 */

function makePackDir(): string {
  return mkdtempSync(join(tmpdir(), 'pack-docs-'));
}

function installed(manifest: Record<string, unknown>, originPath?: string): InstalledMiniApp {
  return {
    manifest,
    origin: originPath ? { kind: 'imported', path: originPath } : { kind: 'bundled' },
    digest: 'x',
    enabled: true,
  };
}

function writeBundle(root: string, tree: Record<string, unknown>, pages: Record<string, string>): string {
  const packDir = join(root, 'my-pack');
  mkdirSync(join(packDir, 'docs'), { recursive: true });
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify({ id: 'my-pack' }));
  writeFileSync(join(packDir, 'docs', 'docs-tree.json'), JSON.stringify(tree));
  for (const [name, body] of Object.entries(pages)) {
    writeFileSync(join(packDir, 'docs', name), body);
  }
  return join(packDir, 'manifest.json');
}

const TREE = {
  version: 1,
  categories: [
    {
      category: 'overview',
      items: [
        {
          id: 'overview',
          file: 'overview.md',
          title: 'Overview',
          description: 'What the pack is.',
          audience: 'user',
        },
      ],
    },
    {
      category: 'usage',
      items: [
        {
          id: 'usage',
          file: 'usage.md',
          title: 'Usage',
          description: 'Day-to-day operation.',
          index: true,
        },
      ],
    },
  ],
};

function docsBase(root: string): string {
  return root;
}

describe('packDocsDir', () => {
  it('resolves imported packs beside the installed manifest file; absent docs is honest absence', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(root, TREE, { 'overview.md': '# Overview' });
    const pack = installed({ id: 'my-pack' }, manifestPath);
    expect(packDocsDir(pack, '/nonexistent-base')).toBeTruthy();

    const bare = mkdtempSync(join(tmpdir(), 'pack-bare-'));
    const bareManifest = join(bare, 'manifest.json');
    writeFileSync(bareManifest, JSON.stringify({ id: 'bare' }));
    expect(packDocsDir(installed({ id: 'bare' }, bareManifest), '/nonexistent-base')).toBeNull();
    expect(existsSync(bare)).toBe(true);
  });
});

describe('packDocs — the binding + landing rule', () => {
  it('serves the validated tree with the landing page (index flag wins)', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(root, TREE, { 'overview.md': '# Overview', 'usage.md': '# Usage' });
    const result = packDocs(installed({ id: 'my-pack', docs: 'docs/docs-tree.json' }, manifestPath), docsBase(root));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.landing).toBe('usage.md');
      expect((result.tree.categories as unknown[]).length).toBe(2);
    }
  });

  it('honest absence without the docs pointer — even when a tree exists on disk', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(root, TREE, { 'overview.md': '# Overview' });
    const result = packDocs(installed({ id: 'my-pack' }, manifestPath), docsBase(root));
    expect(result).toMatchObject({ ok: false });
  });

  it('an invalid tree is an error, never half-served', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(
      root,
      {
        version: 1,
        categories: [
          {
            category: 'getting-started',
            items: [{ id: 'x', file: 'x.md', title: 'X', description: 'Free-form slug.' }],
          },
        ],
      },
      { 'x.md': '# X' },
    );
    const result = packDocs(installed({ id: 'my-pack', docs: 'docs/docs-tree.json' }, manifestPath), docsBase(root));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('docs tree invalid');
    }
  });
});

describe('packDocPage — the watchdog', () => {
  it('reads a tree-listed page and neutralizes raw HTML fence-aware', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(root, TREE, {
      'overview.md': '# Overview\n\n<script>alert(1)</script>\n\n```\n<div>kept</div>\n```\n',
      'usage.md': '# Usage',
    });
    const pack = installed({ id: 'my-pack', docs: 'docs/docs-tree.json' }, manifestPath);
    const page = packDocPage(pack, 'overview.md', docsBase(root));
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.markdown).not.toContain('<script>');
      expect(page.markdown).toContain('&lt;script&gt;');
      expect(page.markdown).toContain('<div>kept</div>');
    }
  });

  it('refuses files the tree does not list — no arbitrary reads', () => {
    const root = makePackDir();
    const manifestPath = writeBundle(root, TREE, { 'overview.md': '# Overview', 'usage.md': '# Usage' });
    writeFileSync(join(root, 'my-pack', 'docs', 'secret.md'), '# secret');
    const pack = installed({ id: 'my-pack', docs: 'docs/docs-tree.json' }, manifestPath);
    expect(packDocPage(pack, 'secret.md', docsBase(root))).toMatchObject({ ok: false });
    expect(packDocPage(pack, '../manifest.json', docsBase(root))).toMatchObject({ ok: false });
    expect(packDocPage(pack, '../../etc/passwd', docsBase(root))).toMatchObject({ ok: false });
  });
});

describe('pure helpers', () => {
  it('landingFile defaults to the first item of the first category', () => {
    expect(
      landingFile({ categories: [{ category: 'overview', items: [{ id: 'a', file: 'a.md' }] }] }),
    ).toBe('a.md');
  });

  it('stripRawHtml spares fences, inline code and autolinks', () => {
    const out = stripRawHtml('See <https://example.org> and `<b>x</b>`.\n\n```\n<i>fence</i>\n```\n');
    expect(out).toContain('<https://example.org>');
    expect(out).toContain('<b>x</b>');
    expect(out).toContain('<i>fence</i>');
    expect(stripRawHtml('<u>gone</u>')).toBe('&lt;u&gt;gone&lt;/u&gt;');
  });
});
