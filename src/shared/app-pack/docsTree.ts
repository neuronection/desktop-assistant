import { DOCS_TREE_SCHEMA } from './extension.generated';
import { checkSchema } from './schemaCheck';

/**
 * The per-extension docs binding (plan 34 §10.3/§10.5 — desktop's
 * adoption at the import seam): a manifest carrying the `docs` pointer
 * promises a `docs/docs-tree.json` that exists beside it and validates
 * against the vendored docs-tree schema's `extensionDocsTree` form PLUS
 * the wall semantics the schema cannot express (unique ids, each closed
 * category once, at-most-one `index`, every `file` resolving beside the
 * tree). Mirrors `docs_tree_semantics` in the vendored contract.py and
 * dev wall 14 — a broken promise rejects discovery/import exactly like
 * an invalid manifest (never half-installs).
 */

export const DOCS_POINTER = 'docs/docs-tree.json';

export type DocsTreeProblem = string;

export function isExtensionDocsTree(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'categories' in value;
}

/** Schema + wall semantics over a parsed tree; `fileExists` resolves refs beside the tree. */
export function checkExtensionDocsTree(tree: unknown, fileExists?: (file: string) => boolean): DocsTreeProblem[] {
  const problems: string[] = [];
  const schemaVerdict = checkSchema(
    (DOCS_TREE_SCHEMA as { $defs: { extensionDocsTree: unknown } }).$defs.extensionDocsTree,
    tree,
    DOCS_TREE_SCHEMA
  );
  for (const issue of schemaVerdict.ok ? [] : schemaVerdict.issues) {
    problems.push(`${issue.path} ${issue.message}`);
  }
  if (!isExtensionDocsTree(tree)) {
    return problems;
  }
  const ids: string[] = [];
  const slugs: string[] = [];
  const indexClaims: string[] = [];
  for (const category of (tree.categories as unknown[]) ?? []) {
    if (typeof category !== 'object' || category === null || Array.isArray(category)) {
      continue;
    }
    slugs.push(String((category as { category?: unknown }).category));
    for (const item of ((category as { items?: unknown[] }).items ?? [])) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }
      const entry = item as { id?: unknown; file?: unknown; index?: unknown };
      ids.push(String(entry.id));
      if (entry.index === true) {
        indexClaims.push(String(entry.id));
      }
      if (fileExists && typeof entry.file === 'string' && !fileExists(entry.file)) {
        problems.push(`item ${String(entry.id)}: file ${entry.file} does not resolve beside the tree`);
      }
    }
  }
  const duplicateSlugs = [...new Set(slugs.filter((slug, index) => slugs.indexOf(slug) !== index))];
  if (duplicateSlugs.length > 0) {
    problems.push(`duplicate category slugs ${JSON.stringify(duplicateSlugs)} (each closed category appears at most once)`);
  }
  if (indexClaims.length > 1) {
    problems.push(`index: true on more than one item ${JSON.stringify(indexClaims)} (the landing rule allows exactly one)`);
  }
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    problems.push(`duplicate node ids ${JSON.stringify(duplicates)}`);
  }
  return problems;
}
