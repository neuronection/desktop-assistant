import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import Ajv2020 from 'ajv/dist/2020';

const repo = resolve(__dirname, '..');
const SET_TREE = resolve(repo, 'docs/dev/sdk/docs-tree.json');
const VENDORED_SCHEMA = resolve(repo, 'contracts/docs-tree.schema.json');
const PRODUCT_TREE = resolve(repo, 'docs/docs-tree.json');

const TEN_CHAPTERS = [
  'overview',
  'quickstart',
  'core-concepts',
  'installation-and-modes',
  'authoring-and-configuration',
  'examples-and-use-cases',
  'security-and-gotchas',
  'reference',
  'versioning-and-migration',
  'troubleshooting-and-faq',
];

interface TreeNode {
  id?: string;
  file?: string;
  children?: TreeNode[];
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function flattenNodes(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.shift() as TreeNode;
    out.push(node);
    stack.push(...(node.children ?? []));
  }
  return out;
}

describe('pack SDK doc-set tree (plan 34 wave 3)', () => {
  const tree = readJson(SET_TREE) as {
    chapters?: string[];
    roots?: TreeNode[];
  };
  const nodes = flattenNodes(tree.roots ?? []);
  const ids = nodes.map((n) => n.id);

  it('validates against the vendored docs-tree contract (draft 2020-12)', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const schema = readJson(VENDORED_SCHEMA);
    const validate = ajv.compile(schema);
    const ok = validate(tree);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('declares exactly the ten taxonomy chapters and every chapter has its node', () => {
    expect(tree.chapters).toEqual(TEN_CHAPTERS);
    const missing = TEN_CHAPTERS.filter((slug) => !ids.includes(slug));
    expect(missing).toEqual([]);
  });

  it('has unique node ids', () => {
    const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(dupes).toEqual([]);
  });

  it('references existing files, relative to the tree directory', () => {
    const base = dirname(SET_TREE);
    const missing = nodes
      .filter((n) => typeof n.file === 'string')
      .map((n) => n.file as string)
      .filter((file) => !existsSync(resolve(base, file)));
    expect(missing).toEqual([]);
  });

  it('lists every set page exactly once in the product docs tree (both-trees law)', () => {
    const product = readJson(PRODUCT_TREE) as {
      audiences?: { categories?: { items?: { file?: string }[] }[] }[];
    };
    const listed = (product.audiences ?? []).flatMap((audience) =>
      (audience.categories ?? []).flatMap((category) => (category.items ?? []).map((item) => item.file ?? '')),
    );
    const setFiles = nodes
      .filter((n) => typeof n.file === 'string')
      .map((n) => resolve(dirname(SET_TREE), n.file as string).replace(/\\/g, '/'))
      .map((abs) => abs.slice(resolve(repo, 'docs').length + 1));
    for (const file of setFiles) {
      expect(listed.filter((entry) => entry === file)).toHaveLength(1);
    }
  });
});
