import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DOCS_POINTER, checkExtensionDocsTree, type DocsTreeProblem } from '@shared/app-pack/docsTree';
import type { InstalledMiniApp } from './registry';
import type { PackDocPageResult, PackDocsResult } from '@shared/app-pack';

/**
 * Pack documentation serving (plan 34 wave 8 — the per-extension docs
 * surface, main side). The watchdog law: every page read is validated
 * against the pack's VALIDATED docs tree — only tree-listed files are
 * readable, every read is containment-checked inside the pack's docs
 * dir, byte-capped. The renderer is untrusted: it names a pack id and a
 * file string; this module decides what may be read. Pure node — the
 * electron-aware base resolution lives at the IPC seam.
 */

/** The docs-tree byte cap (mirrors the manifest cap discipline). */
const TREE_MAX_BYTES = 256 * 1024;
/** Per-page byte cap — doc pages are short by contract. */
const PAGE_MAX_BYTES = 512 * 1024;

/** The raw-HTML markdown law (§10.7) — the family fence-aware shape
 * (health's strip_raw_html, TS twin): raw HTML outside code fences and
 * inline code spans becomes escaped text; autolinks and full-line HTML
 * comments stay. */
const RAW_HTML = /<\s*\/?[a-zA-Z!][^>\n]*>/;
const AUTOLINK = /^<[a-zA-Z][a-zA-Z0-9+.\-]*(:|@)[^>\n]*>$/;
const COMMENT_LINE = /^\s*<!--.*-->\s*$/;
const FENCE = /^[\t ]*(`{3,}|~{3,})/;

export function stripRawHtml(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const segments = line.split(/(`[^`\n]*`)/);
    let rebuilt = '';
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (i % 2 === 1) {
        rebuilt += segment;
        continue;
      }
      let cursor = segment;
      for (;;) {
        const match = RAW_HTML.exec(cursor);
        if (!match) {
          rebuilt += cursor;
          break;
        }
        const tag = match[0];
        if (AUTOLINK.test(tag.trim()) || COMMENT_LINE.test(line)) {
          rebuilt += cursor.slice(0, match.index + tag.length);
        } else {
          rebuilt += cursor.slice(0, match.index);
          rebuilt += tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        cursor = cursor.slice(match.index + tag.length);
      }
    }
    out.push(rebuilt);
  }
  return out.join('\n');
}

/** The landing rule (plan 34 §10.4): the first item of the first
 * category, unless exactly one item carries `index: true` (the checker
 * has already pinned at-most-one). */
export function landingFile(tree: Record<string, unknown>): string | null {
  const categories = (tree.categories as { items?: { file?: unknown; index?: unknown }[] }[]) ?? [];
  for (const category of categories) {
    for (const item of category.items ?? []) {
      if (item.index === true && typeof item.file === 'string') {
        return item.file;
      }
    }
  }
  for (const category of categories) {
    for (const item of category.items ?? []) {
      if (typeof item.file === 'string') {
        return item.file;
      }
    }
  }
  return null;
}

/** Where a pack's docs live. Bundled packs: `<bundledBase>/<id>/docs` —
 * the in-repo `src/packs` (dev) or the packaged `resources/packs` copy,
 * the same dual resolution as the sandbox child (the caller resolves the
 * base electron-aware). Imported packs: beside the installed bundle's
 * manifest file. Absent dir ⇒ honest absence (no docs). */
export function packDocsDir(installed: InstalledMiniApp, bundledBase: string): string | null {
  if (installed.origin.kind === 'imported' && typeof installed.origin.path === 'string' && installed.origin.path.length > 0) {
    const bundleRoot = resolve(installed.origin.path, '..');
    const docs = join(bundleRoot, 'docs');
    return existsSync(docs) ? docs : null;
  }
  const docs = join(bundledBase, String((installed.manifest as { id?: unknown }).id ?? ''), 'docs');
  return existsSync(docs) ? docs : null;
}

function treeListedFiles(tree: Record<string, unknown>): Set<string> {
  const files = new Set<string>();
  const categories = (tree.categories as { items?: { file?: unknown }[] }[]) ?? [];
  for (const category of categories) {
    for (const item of category.items ?? []) {
      if (typeof item.file === 'string') {
        files.add(item.file);
      }
    }
  }
  return files;
}

function loadValidatedTree(docsDir: string): { ok: true; tree: Record<string, unknown>; landing: string; files: Set<string> } | { ok: false; error: string } {
  const treePath = join(docsDir, 'docs-tree.json');
  if (!existsSync(treePath)) {
    return { ok: false, error: 'This pack ships no documentation.' };
  }
  let raw: Buffer;
  try {
    raw = readFileSync(treePath);
  } catch (error) {
    return { ok: false, error: `docs tree unreadable: ${(error as Error).message}` };
  }
  if (raw.byteLength > TREE_MAX_BYTES) {
    return { ok: false, error: `docs tree exceeds the ${TREE_MAX_BYTES}-byte cap` };
  }
  let tree: unknown;
  try {
    tree = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    return { ok: false, error: `docs tree is not JSON: ${(error as Error).message}` };
  }
  const problems: DocsTreeProblem[] = checkExtensionDocsTree(tree, (file) => existsSync(join(docsDir, file)));
  if (problems.length > 0) {
    return { ok: false, error: `docs tree invalid: ${problems.slice(0, 3).join('; ')}` };
  }
  const landing = landingFile(tree as Record<string, unknown>);
  if (!landing) {
    return { ok: false, error: 'docs tree carries no pages' };
  }
  return {
    ok: true,
    tree: tree as Record<string, unknown>,
    landing,
    files: treeListedFiles(tree as Record<string, unknown>),
  };
}

/** Internal: pointer + dir + validated tree with its listed files. */
function validatedDocs(
  installed: InstalledMiniApp,
  bundledBase: string,
): { ok: true; docsDir: string; tree: Record<string, unknown>; landing: string; files: Set<string> } | { ok: false; error: string } {
  const pointer = (installed.manifest as { docs?: unknown } | null)?.docs;
  if (pointer !== DOCS_POINTER) {
    return { ok: false, error: 'This pack ships no documentation.' };
  }
  const docsDir = packDocsDir(installed, bundledBase);
  if (!docsDir) {
    return { ok: false, error: 'This pack ships no documentation.' };
  }
  const loaded = loadValidatedTree(docsDir);
  if (!loaded.ok) {
    return loaded;
  }
  return { ok: true, docsDir, tree: loaded.tree, landing: loaded.landing, files: loaded.files };
}

/** Tree + landing page reference for one installed pack (the dialog's
 * first read). Packs without a docs pointer answer with honest absence. */
export function packDocs(installed: InstalledMiniApp, bundledBase: string): PackDocsResult {
  const docs = validatedDocs(installed, bundledBase);
  if (!docs.ok) {
    return docs;
  }
  return { ok: true, tree: docs.tree, landing: docs.landing };
}

/** One page, tree-listed + containment-checked + neutralized. */
export function packDocPage(installed: InstalledMiniApp, file: string, bundledBase: string): PackDocPageResult {
  const docs = validatedDocs(installed, bundledBase);
  if (!docs.ok) {
    return docs;
  }
  if (!docs.files.has(file)) {
    return { ok: false, error: 'Only documentation pages listed in the tree can be read.' };
  }
  const root = resolve(docs.docsDir);
  const pagePath = resolve(root, file);
  if (pagePath !== root && !pagePath.startsWith(root + '/')) {
    return { ok: false, error: 'Page path escapes the docs directory.' };
  }
  if (!existsSync(pagePath)) {
    return { ok: false, error: `Page not found: ${file}` };
  }
  let raw: Buffer;
  try {
    raw = readFileSync(pagePath);
  } catch (error) {
    return { ok: false, error: `page unreadable: ${(error as Error).message}` };
  }
  if (raw.byteLength > PAGE_MAX_BYTES) {
    return { ok: false, error: `page exceeds the ${PAGE_MAX_BYTES}-byte cap` };
  }
  return { ok: true, markdown: stripRawHtml(raw.toString('utf8')) };
}
