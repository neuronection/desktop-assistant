import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { interpolate, TEXT } from '@shared/constants/text';
import type { MiniAppRunTreeDirectoryView, MiniAppRunTreeView, PackOverrideAction, PackVerdict } from '@shared/app-pack';
import { humanBytes } from './PackItemDrawer';

export function directoryBadges(dir: MiniAppRunTreeDirectoryView, verdictFilter: string, labels: Record<string, string>): ReactElement {
  const counts = verdictFilter === 'all' ? dir.totalCounts : { keep: 0, ask: 0, candidate: 0, [verdictFilter]: dir.totalCounts[verdictFilter as 'keep' | 'ask' | 'candidate'] };
  const size =
    verdictFilter === 'all'
      ? dir.totalSizeByVerdict
      : { keep: null, ask: null, candidate: null, [verdictFilter]: dir.totalSizeByVerdict[verdictFilter as 'keep' | 'ask' | 'candidate'] };
  const total = counts.keep + counts.ask + counts.candidate;
  const sizeSum = verdictFilter === 'all' ? (size.keep === null || size.ask === null || size.candidate === null ? null : (size.keep ?? 0) + (size.ask ?? 0) + (size.candidate ?? 0)) : size[verdictFilter as 'keep' | 'ask' | 'candidate'];
  return (
    <span className="flex flex-wrap items-center gap-1">
      {verdictFilter !== 'all' ? (
        <Badge variant="outline" className="text-[10px]" data-testid={`tree-badge-${dir.path || 'root'}`}>
          {counts[verdictFilter as 'keep' | 'ask' | 'candidate']}
        </Badge>
      ) : (
        (['keep', 'ask', 'candidate'] as const)
          .filter((verdict) => counts[verdict] > 0)
          .map((verdict) => (
            <Badge key={verdict} variant="outline" className="text-[10px]" data-testid={`tree-badge-${verdict}-${dir.path || 'root'}`}>
              {labels[`status.${verdict}`] ?? verdict} {counts[verdict]}
            </Badge>
          ))
      )}
      <span className="tabular-nums text-[10px] text-[var(--as-muted-foreground)]">
        {sizeSum !== null ? humanBytes(sizeSum) : '—'}
        {verdictFilter === 'all' ? ` · ${total}` : ''}
      </span>
    </span>
  );
}

interface TreeNode {
  dir: MiniAppRunTreeDirectoryView;
  children: TreeNode[];
}

function buildTree(directories: MiniAppRunTreeDirectoryView[]): TreeNode {
  const nodes = new Map<string, TreeNode>();
  for (const dir of directories) {
    nodes.set(dir.path, { dir, children: [] });
  }
  const root = nodes.get('') ?? { dir: directories[0], children: [] };
  for (const [path, node] of nodes) {
    if (path === '') {
      continue;
    }
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    (nodes.get(parentPath) ?? root).children.push(node);
  }
  const sortChildren = (node: TreeNode): void => {
    node.children.sort((a, b) => a.dir.path.localeCompare(b.dir.path));
    for (const child of node.children) {
      sortChildren(child);
    }
  };
  sortChildren(root);
  return root;
}

function DirectoryNode({
  node,
  depth,
  selectedDir,
  expanded,
  onToggle,
  verdictFilter,
  labels,
}: {
  node: TreeNode;
  depth: number;
  selectedDir: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  verdictFilter: string;
  labels: Record<string, string>;
}): ReactElement | null {
  const path = node.dir.path;
  const name = path === '' ? TEXT.MINIAPPS_TREE_ROOT : path.slice(path.lastIndexOf('/') + 1);
  const isExpanded = expanded.has(path);
  const childNodes = isExpanded ? node.children.map((child) => (
    <DirectoryNode
      key={child.dir.path}
      node={child}
      depth={depth + 1}
      selectedDir={selectedDir}
      expanded={expanded}
      onToggle={onToggle}
      verdictFilter={verdictFilter}
      labels={labels}
    />
  )) : null;
  return (
    <li>
      <button
        type="button"
        aria-expanded={isExpanded}
        data-testid={`tree-node-${path || 'root'}`}
        aria-current={selectedDir === path ? 'true' : undefined}
        onClick={() => onToggle(path)}
        className={`flex w-full flex-wrap items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-[var(--as-muted)] ${selectedDir === path ? 'bg-[var(--as-muted)]' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <span aria-hidden className="w-3 shrink-0 text-[var(--as-muted-foreground)]">{node.children.length > 0 ? (isExpanded ? '▾' : '▸') : '·'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
        {directoryBadges(node.dir, verdictFilter, labels)}
      </button>
      {childNodes && <ul className="space-y-0.5">{childNodes}</ul>}
    </li>
  );
}

/**
 * The directory tree rail (plan 51 S3.4): disclosure buttons with
 * aggregate verdict/size badges — collapsed subtrees stay summarized,
 * expanding navigates the paged table below. Aggregates come from the
 * main-side index, never from renderer row scans.
 */
export function DirectoryTree({
  tree,
  selectedDir,
  expanded,
  onToggle,
  verdictFilter,
  labels,
}: {
  tree: MiniAppRunTreeView;
  selectedDir: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  verdictFilter: string;
  labels: Record<string, string>;
}): ReactElement {
  const root = buildTree(tree.directories);
  return (
    <nav aria-label={TEXT.MINIAPPS_TREE_ARIA} className="min-w-0 shrink-0 space-y-1 md:w-64" data-testid="directory-tree">
      <ul className="space-y-0.5">
        <DirectoryNode
          node={root}
          depth={0}
          selectedDir={selectedDir}
          expanded={expanded}
          onToggle={onToggle}
          verdictFilter={verdictFilter}
          labels={labels}
        />
      </ul>
    </nav>
  );
}

/**
 * The in-flow directory-action confirmation (plan 51 S3.4 — popup
 * chrome law): pinned title + body + Cancel/Confirm action row.
 */
export function ScopedActionConfirm({
  dir,
  count,
  action,
  onConfirm,
  onCancel,
}: {
  dir: string;
  count: number;
  action: 'keep' | 'exclude';
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const title =
    action === 'keep'
      ? interpolate(TEXT.MINIAPPS_DIR_KEEP_CONFIRM_TITLE, { count: String(count), dir: dir || TEXT.MINIAPPS_TREE_ROOT })
      : interpolate(TEXT.MINIAPPS_DIR_EXCLUDE_CONFIRM_TITLE, { count: String(count), dir: dir || TEXT.MINIAPPS_TREE_ROOT });
  return (
    <div role="alertdialog" aria-label={title} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3" data-testid="scoped-action-confirm">
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_DIR_CONFIRM_BODY}</p>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--as-border)] pt-2">
        <Button size="sm" variant="outline" onClick={onCancel}>
          {TEXT.MINIAPPS_DIR_CONFIRM_CANCEL}
        </Button>
        <Button size="sm" onClick={onConfirm} data-testid="scoped-action-confirm-go">
          {TEXT.MINIAPPS_DIR_CONFIRM_GO}
        </Button>
      </div>
    </div>
  );
}

/** The selection-mode bulk bar (plan 51 S3.7) — in-flow above the table. */
export function BulkBar({
  count,
  folderCount,
  onApply,
  onSelectAllFolder,
  onDone,
}: {
  count: number;
  folderCount: number;
  onApply: (action: PackOverrideAction) => void;
  onSelectAllFolder: () => void;
  onDone: () => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-muted)] p-2 text-xs" data-testid="bulk-bar">
      <span data-testid="bulk-count">{interpolate(TEXT.MINIAPPS_BULK_COUNT, { count: String(count) })}</span>
      <Button size="sm" variant="outline" disabled={count === 0} onClick={() => onApply('keep')} data-testid="bulk-keep">
        {TEXT.MINIAPPS_REVIEW_KEEP}
      </Button>
      <Button size="sm" variant="outline" disabled={count === 0} onClick={() => onApply('candidate')} data-testid="bulk-candidate">
        {TEXT.MINIAPPS_REVIEW_CANDIDATE}
      </Button>
      <Button size="sm" variant="outline" disabled={count === 0} onClick={() => onApply('exclude')} data-testid="bulk-exclude">
        {TEXT.MINIAPPS_REVIEW_EXCLUDE}
      </Button>
      <Button size="sm" variant="outline" disabled={count === 0} onClick={() => onApply('ask')} data-testid="bulk-ask">
        {TEXT.MINIAPPS_REVIEW_ASK_AGAIN}
      </Button>
      <Button size="sm" variant="ghost" onClick={onSelectAllFolder} data-testid="bulk-select-folder">
        {interpolate(TEXT.MINIAPPS_SELECT_ALL_FOLDER, { count: String(folderCount) })}
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone} data-testid="bulk-done">
        {TEXT.MINIAPPS_SELECT_DONE}
      </Button>
    </div>
  );
}

/** Escape exits selection mode — pane-scoped, commit-phase subscription with a latest-ref read. */
export function useEscapeTo(fn: () => void): void {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  }, [fn]);
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        latest.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
