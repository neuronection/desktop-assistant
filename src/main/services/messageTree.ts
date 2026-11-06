export interface BranchRow {
  id: string;
  parentId?: string | null;
  activeChildId?: string | null;
  createdAt: Date;
}

export interface BranchDecoration {
  parentId: string | null;
  activeChildId: string | null;
  childIds: string[];
  variantIndex: number;
  variantCount: number;
  siblingIds: string[];
}

const PARENT_NONE = '';

function sortRows<T extends BranchRow>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

export function childrenByParent<T extends BranchRow>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of sortRows(rows)) {
    const key = row.parentId ?? PARENT_NONE;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

export function decorateBranchRows<T extends BranchRow>(rows: T[]): Map<string, BranchDecoration> {
  const byParent = childrenByParent(rows);
  const decoration = new Map<string, BranchDecoration>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId ?? PARENT_NONE) ?? [row];
    const index = siblings.findIndex((sibling) => sibling.id === row.id);
    decoration.set(row.id, {
      parentId: row.parentId ?? null,
      activeChildId: row.activeChildId ?? null,
      childIds: (byParent.get(row.id) ?? []).map((child) => child.id),
      variantIndex: index < 0 ? 0 : index,
      variantCount: siblings.length,
      siblingIds: siblings.map((sibling) => sibling.id),
    });
  }
  return decoration;
}

/** The visible conversation: pointer walk with newest-sibling fallback. */
export function activePathRows<T extends BranchRow>(rows: T[], activeRootId: string | null): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byParent = childrenByParent(rows);
  const roots = byParent.get(PARENT_NONE) ?? [];
  const root =
    (activeRootId && byId.has(activeRootId) ? activeRootId : null) ??
    roots.at(-1)?.id ??
    null;
  const path: T[] = [];
  const seen = new Set<string>();
  let current = root;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) {
      break;
    }
    path.push(node);
    const children = byParent.get(current) ?? [];
    const selected = node.activeChildId && byId.has(node.activeChildId) ? node.activeChildId : null;
    current = selected ?? children.at(-1)?.id ?? null;
  }
  return path;
}

/** One level: the chain from root to the target, inclusive. */
export function ancestorChain<T extends BranchRow>(rows: T[], targetId: string): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: T[] = [];
  let current = byId.get(targetId);
  while (current) {
    chain.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain.reverse();
}
