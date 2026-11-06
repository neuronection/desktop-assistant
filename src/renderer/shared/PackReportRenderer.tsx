import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { SegmentedTabs } from '@neuronection/assistant-ui/segmented-tabs';
import { TEXT, interpolate } from '@shared/constants/text';
import type {
  MiniAppRunDirectoryView,
  PackOverrideAction,
  MiniAppRunItemView,
  MiniAppRunReportView,
  MiniAppRunTreeView,
  PackSurfaceAction,
  PackSurfaceFilter,
  PackSurfaceNode,
  PackSurfaceView,
  PackVerdict,
} from '@shared/app-pack';
import { runStatusLabel } from './runStatus';
import { humanBytes, PackItemDrawer } from './PackItemDrawer';
import { PackSurfaceRenderer, isSurfaceActionId, surfaceTruncatedLabel } from './PackSurfaceRenderer';
import { PackVerdictRings } from './PackVerdictRings';
import { BulkBar, DirectoryTree, ScopedActionConfirm, useEscapeTo } from './PackFilesExplorer';
import { RunActions, RunSummary } from './runSummary';

type ReportNode = Record<string, unknown> & { id: string; type: string };

type ReportTab = 'overview' | 'files' | 'review';

type WidthClass = 'sm' | 'md' | 'lg';

const VERDICTS: readonly PackVerdict[] = ['keep', 'ask', 'candidate'];

const DIRECTORY_PAGE_SIZE = 200;
const BULK_BATCH_SIZE = 500;
const PREFIX_MAX_ITEMS = 2000;

const SORT_KEYS = ['path', 'size', 'age', 'confidence', 'verdict'] as const;
type SortKey = (typeof SORT_KEYS)[number];
const GROUP_KEYS = ['none', 'verdict', 'category', 'decidedBy'] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

const VERDICT_ORDER: Record<PackVerdict, number> = { keep: 0, ask: 1, candidate: 2 };

const HOST_COLUMN_LABELS: Record<string, string> = {
  path: TEXT.MINIAPPS_REPORT_COL_PATH,
  verdict: TEXT.MINIAPPS_REPORT_COL_VERDICT,
  confidence: TEXT.MINIAPPS_REPORT_COL_CONFIDENCE,
  decidedBy: TEXT.MINIAPPS_REPORT_COL_DECIDED_BY,
  size: TEXT.MINIAPPS_REPORT_COL_SIZE,
  age: TEXT.MINIAPPS_REPORT_COL_AGE,
  category: TEXT.MINIAPPS_REPORT_COL_CATEGORY,
};

const SORT_LABELS: Record<SortKey, string> = {
  path: TEXT.MINIAPPS_SORT_PATH,
  size: TEXT.MINIAPPS_SORT_SIZE,
  age: TEXT.MINIAPPS_SORT_AGE,
  confidence: TEXT.MINIAPPS_SORT_CONFIDENCE,
  verdict: TEXT.MINIAPPS_SORT_VERDICT,
};

const GROUP_LABELS: Record<GroupKey, string> = {
  none: TEXT.MINIAPPS_GROUP_NONE,
  verdict: TEXT.MINIAPPS_GROUP_VERDICT,
  category: TEXT.MINIAPPS_GROUP_CATEGORY,
  decidedBy: TEXT.MINIAPPS_GROUP_DECIDED_BY,
};

const HOST_ACTION_LABELS: Record<string, string> = {
  'action.run:export': TEXT.MINIAPPS_RUN_EXPORT_MD,
  'action.item:reveal': TEXT.MINIAPPS_ITEM_REVEAL,
  'action.item:open': TEXT.MINIAPPS_ITEM_OPEN,
  'action.item:restore': TEXT.MINIAPPS_RESTORE_ITEM,
};

const STATUS_DOT_CLASS: Record<string, string> = {
  done: 'bg-[var(--as-success)]',
  failed: 'bg-[var(--as-danger)]',
  paused: 'bg-[var(--as-warning)]',
};

const RUN_LEVEL_ACTION = 'run:export';

export function paneWidthClass(width: number): WidthClass {
  if (width < 480) {
    return 'sm';
  }
  if (width < 720) {
    return 'md';
  }
  return 'lg';
}

interface RowModel {
  item: MiniAppRunItemView;
  size: number | null;
  ageDays: number | null;
  category: string | null;
  decidedByKind: string;
}

function rowModelOf(item: MiniAppRunItemView, labels: Record<string, string>): RowModel {
  const meta = (item.evidence?.meta as { size?: unknown; ageDays?: unknown } | undefined) ?? undefined;
  const answers = item.evidence?.answers as { category?: { choice?: unknown } } | undefined;
  const choice = answers?.category?.choice;
  return {
    item,
    size: typeof meta?.size === 'number' ? meta.size : null,
    ageDays: typeof meta?.ageDays === 'number' ? meta.ageDays : null,
    category: typeof choice === 'string' ? (labels[`status.${choice}`] ?? choice) : null,
    decidedByKind: item.decidedBy.split(':')[0] ?? item.decidedBy,
  };
}

function sortValue(model: RowModel, key: SortKey): string | number {
  switch (key) {
    case 'path':
      return model.item.relPath;
    case 'size':
      return model.size ?? -1;
    case 'age':
      return model.ageDays ?? -1;
    case 'confidence':
      return model.item.confidence ?? -1;
    case 'verdict':
      return VERDICT_ORDER[model.item.verdict];
  }
}

function groupValue(model: RowModel, key: GroupKey, labels: Record<string, string>): string {
  switch (key) {
    case 'none':
      return '';
    case 'verdict':
      return model.item.verdict;
    case 'category':
      return model.category ?? '';
    case 'decidedBy':
      return labels[`status.${model.decidedByKind}`] ?? model.decidedByKind;
  }
}

function derivedEvidenceSummary(item: MiniAppRunItemView, labels: Record<string, string>): string | undefined {
  const evidence = item.evidence;
  if (!evidence) {
    return undefined;
  }
  const rule = typeof evidence.rule === 'string' ? labels[`rule.${evidence.rule}`] ?? evidence.rule : null;
  const answers = evidence.answers && typeof evidence.answers === 'object' ? Object.keys(evidence.answers as Record<string, unknown>) : null;
  const parts: string[] = [];
  if (rule) {
    parts.push(rule);
  }
  if (answers?.length) {
    parts.push(answers.join(', '));
  }
  if (typeof evidence.userOverride === 'boolean' && evidence.userOverride) {
    parts.push(TEXT.MINIAPPS_EVIDENCE_OVERRIDE_LABEL);
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
}

function ReclaimLine({ report, tree }: { report: MiniAppRunReportView; tree: MiniAppRunTreeView | null }): ReactElement {
  const [quarantinedBytes, setQuarantinedBytes] = useState<number | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await window.electronAPI.miniAppQuarantineStatus(report.run.packId);
        if (!cancelled) {
          setQuarantinedBytes(status.bytes);
        }
      } catch {
        if (!cancelled) {
          setQuarantinedBytes(null);
        }
      }
      try {
        const runDigest = await window.electronAPI.getMiniAppRunDigest(report.run.id);
        if (!cancelled) {
          setDigest(runDigest);
        }
      } catch {
        if (!cancelled) {
          setDigest(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report.run.packId, report.run.id]);

  const candidateBytes = useMemo(() => {
    const fromTree = tree?.directories.find((dir) => dir.path === '')?.totalSizeByVerdict.candidate;
    if (typeof fromTree === 'number') {
      return fromTree;
    }
    return report.items.reduce((sum, item) => {
      if (item.verdict !== 'candidate') {
        return sum;
      }
      const meta = item.evidence?.meta as { size?: unknown } | undefined;
      return typeof meta?.size === 'number' ? sum + meta.size : sum;
    }, 0);
  }, [tree, report.items]);

  return (
    <div className="space-y-1" data-testid="report-overview-lines">
      <p className="text-xs text-[var(--as-muted-foreground)]" data-testid="report-reclaim-line">
        {interpolate(TEXT.MINIAPPS_REPORT_RECLAIMABLE, {
          size: candidateBytes > 0 ? humanBytes(candidateBytes) : '—',
          quarantined: quarantinedBytes !== null && quarantinedBytes > 0 ? humanBytes(quarantinedBytes) : '—',
        })}
      </p>
      {digest && (
        <p className="rounded-lg border border-[var(--as-border)] p-2 text-xs" data-testid="report-digest">
          <span className="mr-1.5 font-medium">{TEXT.MINIAPPS_DIGEST_LABEL}:</span>
          {digest}
          <span className="mt-0.5 block text-[10px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_AI_LABEL}</span>
        </p>
      )}
    </div>
  );
}

function OverviewTab({ report, nodes, tree }: { report: MiniAppRunReportView; nodes: PackSurfaceNode[]; tree: MiniAppRunTreeView | null }): ReactElement {
  const totals = report.run.totals;
  const surface = useMemo<PackSurfaceView>(
    () => ({
      nodes,
      rows: [],
      values: {
        run: { status: runStatusLabel(report.run.status) },
        ...(totals ? { totals: totals as unknown as Record<string, unknown> } : {}),
      },
    }),
    [nodes, report.run.status, totals]
  );
  return (
    <div className="space-y-4">
      <p className="truncate font-mono text-[11px] text-[var(--as-muted-foreground)]" title={report.run.rootPath} data-testid="report-root-path">
        <span className="font-sans">{TEXT.MINIAPPS_DRAWER_FOLDER}: </span>
        {report.run.rootPath}
      </p>
      {totals && <PackVerdictRings totals={totals} labels={report.labels} />}
      {totals && (
        <p className="text-xs text-[var(--as-muted-foreground)]" data-testid="report-totals-line">
          {interpolate(TEXT.MINIAPPS_REPORT_TOTALS, {
            scanned: String(totals.scanned),
            keep: String(totals.keep),
            ask: String(totals.ask),
            candidate: String(totals.candidate),
          })}
        </p>
      )}
      <ReclaimLine report={report} tree={tree} />
      <PackSurfaceRenderer surface={surface} labels={report.labels} />
    </div>
  );
}

const REVIEW_QUEUE_PAGE_SIZE = 200;

function ReviewTab({ runId, onOverride }: { runId: string; onOverride: (relPath: string, action: PackOverrideAction) => Promise<void> }): ReactElement | null {
  const [items, setItems] = useState<MiniAppRunItemView[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listing = await window.electronAPI.getMiniAppRunDirectory(runId, '', page, 'ask');
        if (!cancelled && listing) {
          setItems(listing.items);
          setPageCount(listing.pageCount);
          setTotal(listing.totalMatching);
        }
      } catch {
        if (!cancelled) {
          setItems(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, page]);

  const pending = (items ?? []).filter((item) => !done.has(item.relPath));

  if (items === null) {
    return null;
  }
  if (total === 0 || (pending.length === 0 && page >= pageCount)) {
    return (
      <p className="rounded-xl border border-[var(--as-border)] p-3 text-xs text-[var(--as-muted-foreground)]" role="status">
        {TEXT.MINIAPPS_REVIEW_EMPTY}
      </p>
    );
  }
  return (
    <section aria-label={interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(total - done.size) })} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <h4 className="text-sm font-medium">{interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(total - done.size) })}</h4>
      <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_REVIEW_HINT}</p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {pending.map((item) => (
          <li key={item.relPath} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="truncate">{item.relPath}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'keep');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_KEEP}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'candidate');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_CANDIDATE}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDone((current) => new Set(current).add(item.relPath));
                  void onOverride(item.relPath, 'exclude');
                }}
              >
                {TEXT.MINIAPPS_REVIEW_EXCLUDE}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {TEXT.MINIAPPS_DIR_PREV}
          </Button>
          <span className="text-[var(--as-muted-foreground)]">
            {interpolate(TEXT.MINIAPPS_DIR_PAGE_STATUS, { page: String(page), pageCount: String(pageCount), count: String(total), dir: TEXT.MINIAPPS_TREE_ROOT })}
          </span>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            {TEXT.MINIAPPS_DIR_NEXT}
          </Button>
        </div>
      )}
    </section>
  );
}

const VERDICT_TONE_CLASS: Record<PackVerdict, string> = {
  keep: 'border-[var(--as-success)] text-[var(--as-success)] bg-[color-mix(in_srgb,var(--as-success)_14%,transparent)]',
  ask: 'border-[var(--as-warning)] text-[var(--as-warning)] bg-[color-mix(in_srgb,var(--as-warning)_14%,transparent)]',
  candidate: 'border-[var(--as-danger)] text-[var(--as-danger)] bg-[color-mix(in_srgb,var(--as-danger)_14%,transparent)]',
};

/**
 * The Files table (plan 51 S3.3/S3.5/S3.6/S3.7; plan 52 S3.2/S3.3):
 * fits its container by design — `table-fixed w-full`, no horizontal
 * scroll anywhere, and the sticky header scrolls with the results area.
 * Every row is a name block — the filename clamped at 3 lines
 * (multilingual + unbroken-token safe) over ONE meta line (verdict
 * chip, confidence mini-bar, size, truncated evidence chip) — plus one
 * compact actions cell with the primary quick action; the popup carries
 * the full facts. Rows open the popup, except in selection mode where a
 * click toggles.
 */
function FilesTable({
  rows,
  labels,
  tableNodeId,
  onOverride,
  onOpenDrawer,
  selectedPath,
  selectionMode,
  selectedPaths,
  onToggleRow,
  onToggleAllPage,
}: {
  rows: RowModel[];
  labels: Record<string, string>;
  tableNodeId: string;
  onOverride: (relPath: string, action: PackOverrideAction) => Promise<void>;
  onOpenDrawer: (item: MiniAppRunItemView, element: HTMLElement) => void;
  selectedPath: string | null;
  selectionMode: boolean;
  selectedPaths: ReadonlySet<string>;
  onToggleRow: (path: string, shiftKey: boolean) => void;
  onToggleAllPage: (select: boolean) => void;
}): ReactElement {
  const columnLabel = (column: string): string => labels[`report.${tableNodeId}.${column}`] ?? HOST_COLUMN_LABELS[column] ?? column;

  const primaryAction = (model: RowModel): { action: 'keep' | 'candidate'; label: string } =>
    model.item.verdict === 'keep'
      ? { action: 'candidate', label: TEXT.MINIAPPS_REVIEW_CANDIDATE }
      : { action: 'keep', label: TEXT.MINIAPPS_REVIEW_KEEP };

  const allPageSelected = rows.length > 0 && rows.every((model) => selectedPaths.has(model.item.relPath));

  const openRow = (model: RowModel, event: MouseEvent<HTMLTableRowElement>): void => {
    const info = event.currentTarget.querySelector<HTMLButtonElement>('[data-testid^="report-info-"]');
    onOpenDrawer(model.item, info ?? event.currentTarget);
  };

  return (
    <div className="w-full" data-testid="report-files-table">
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="border-b border-[var(--as-border)] text-left text-[var(--as-muted-foreground)]">
            {selectionMode && (
              <th scope="col" className="w-8 py-1.5 pr-1">
                <input
                  type="checkbox"
                  aria-label={TEXT.MINIAPPS_SELECT_PAGE_ARIA}
                  data-testid="report-select-all-page"
                  checked={allPageSelected}
                  onChange={(event) => onToggleAllPage(event.target.checked)}
                />
              </th>
            )}
            <th scope="col" className="py-1.5 pr-3 font-medium sticky top-0 z-10 bg-[var(--as-background)]">
              {columnLabel('path')}
            </th>
            <th scope="col" className="w-24 py-1.5 pr-1 font-medium sticky top-0 z-10 bg-[var(--as-background)]">
              {TEXT.MINIAPPS_REPORT_COL_ACTIONS}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((model) => (
            <tr
              key={model.item.relPath}
              data-testid={`report-row-${model.item.relPath}`}
              className={`border-b border-[var(--as-border)]/50 align-top transition-colors ${
                selectedPath === model.item.relPath
                  ? 'bg-[color-mix(in_srgb,var(--as-primary)_12%,transparent)] shadow-[inset_3px_0_0_var(--as-primary)]'
                  : 'hover:bg-[color-mix(in_srgb,var(--as-fg)_5%,transparent)]'
              } ${selectionMode ? 'cursor-pointer' : ''}`}
              onClick={selectionMode ? () => onToggleRow(model.item.relPath, false) : (event) => openRow(model, event)}
            >
              {selectionMode && (
                <td className="py-1.5 pr-1" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={interpolate(TEXT.MINIAPPS_SELECT_ROW_ARIA, { path: model.item.relPath })}
                    data-testid={`report-select-${model.item.relPath}`}
                    checked={selectedPaths.has(model.item.relPath)}
                    onChange={(event) => onToggleRow(model.item.relPath, (event.nativeEvent as PointerEvent).shiftKey)}
                  />
                </td>
              )}
              <td className="py-1.5 pr-3">
                <span className="block min-w-0">
                  <button
                    type="button"
                    className={`block w-full text-left font-mono text-[11px] line-clamp-3 [overflow-wrap:anywhere] hover:text-[var(--as-primary)] focus-visible:outline-2 focus-visible:outline-[var(--as-focus-ring)]`}
                    title={model.item.relPath}
                    data-testid={`report-name-${model.item.relPath}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectionMode) {
                        onToggleRow(model.item.relPath, false);
                      } else {
                        onOpenDrawer(model.item, event.currentTarget);
                      }
                    }}
                  >
                    {model.item.relPath}
                  </button>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium ${VERDICT_TONE_CLASS[model.item.verdict]}`}
                      data-testid={`report-verdict-${model.item.relPath}`}
                    >
                      {labels[`status.${model.item.verdict}`] ?? model.item.verdict}
                    </Badge>
                    <span className="tabular-nums text-[10px] text-[var(--as-muted-foreground)]">{model.size !== null ? humanBytes(model.size) : '\u2014'}</span>
                    {derivedEvidenceSummary(model.item, labels) && (
                      <span
                        className="min-w-0 max-w-[min(12rem,100%)] truncate rounded bg-[var(--as-muted)] px-1 text-[10px] text-[var(--as-muted-foreground)]"
                        title={derivedEvidenceSummary(model.item, labels)}
                      >
                        {derivedEvidenceSummary(model.item, labels)}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="w-24 py-1.5 pr-1 align-top">
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {!selectionMode &&
                    (() => {
                      const primary = primaryAction(model);
                      return (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`report-override-${primary.action}-${model.item.relPath}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onOverride(model.item.relPath, primary.action);
                          }}
                        >
                          {primary.label}
                        </Button>
                      );
                    })()}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={interpolate(TEXT.MINIAPPS_ROW_INFO_ARIA, { path: model.item.relPath })}
                    data-testid={`report-info-${model.item.relPath}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDrawer(model.item, event.currentTarget);
                    }}
                  >
                    ⓘ
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The declarative report renderer (plan 26 S5 / ADR-0040 clause 16;
 * plan 51 S3 re-shell): host chrome AROUND the closed declarative
 * surface — a SegmentedTabs shell (Overview: rings + totals + the
 * stat/badge/progress nodes; Files: the directory explorer with the
 * fit-by-design paged table, tree rail, selection mode and scoped
 * actions; Review: the ask queue), host-derived verdict rings, and an
 * item detail drawer with structured evidence. The manifest stays
 * contract-exact; nodes distribute to tabs by type, pack-generic.
 */
export function PackReportRenderer({
  report,
  onOverride,
  onReveal,
  onOpen,
  onRestore,
  onExport,
  onArm,
  onOpenWindow,
  onReportChanged,
}: {
  report: MiniAppRunReportView;
  onOverride: (relPath: string, action: PackOverrideAction) => Promise<void>;
  onReveal: (relPath: string) => Promise<void>;
  onOpen: (relPath: string) => Promise<void>;
  onRestore: (relPath: string) => Promise<void>;
  onExport: () => Promise<void>;
  onArm?: () => void;
  onOpenWindow?: () => void;
  onReportChanged?: () => Promise<void>;
}): ReactElement {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [verdictFilter, setVerdictFilter] = useState<string>('all');
  const [fieldFilter, setFieldFilter] = useState<{ bind: string; value: string } | null>(null);
  const [needle, setNeedle] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('path');
  const [groupBy, setGroupBy] = useState<GroupKey>('verdict');
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const [widthClass, setWidthClass] = useState<WidthClass>('lg');
  const [tree, setTree] = useState<MiniAppRunTreeView | null>(null);
  const [selectedDir, setSelectedDir] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']));
  const [page, setPage] = useState(1);
  const [dirListing, setDirListing] = useState<MiniAppRunDirectoryView | null>(null);
  const [listingTick, setListingTick] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [scopedConfirm, setScopedConfirm] = useState<{ dir: string; count: number; action: 'keep' | 'exclude' } | null>(null);
  const lastToggledRef = useRef<string | null>(null);
  const selectionRef = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const runId = report.run.id;
  const packId = report.run.packId;
  const totals = report.run.totals;

  const nodes = useMemo(
    () =>
      (Array.isArray(report.reportNodes) ? (report.reportNodes as ReportNode[]) : []).map((node) => {
        if ((node.type === 'stat' || node.type === 'badge' || node.type === 'progress') && typeof node.bind !== 'string') {
          return { ...node, bind: 'totals.scanned' };
        }
        if (node.type === 'select' && typeof node.bind !== 'string') {
          return { ...node, bind: 'decidedByKind' };
        }
        return node;
      }) as PackSurfaceNode[],
    [report.reportNodes]
  );

  const overviewNodes = useMemo(() => nodes.filter((node) => ['stat', 'badge', 'progress'].includes(node.type)), [nodes]);
  const filesNodes = useMemo(
    () =>
      nodes.flatMap((node) => {
        if (node.type !== 'actions') {
          return ['filter-bar', 'select'].includes(node.type) ? [node] : [];
        }
        const ids = Array.isArray(node.actions) ? (node.actions as unknown[]).filter((id): id is string => typeof id === 'string' && isSurfaceActionId(id)) : [];
        const rest = ids.filter((id) => id !== RUN_LEVEL_ACTION);
        return rest.length > 0 ? [{ ...node, actions: rest }] : [];
      }),
    [nodes]
  );
  const tableNode = useMemo(() => nodes.find((node) => node.type === 'table'), [nodes]);

  const labels = useMemo(() => {
    const merged: Record<string, string> = { ...report.labels };
    for (const [key, value] of Object.entries(HOST_ACTION_LABELS)) {
      if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
    for (const node of nodes) {
      if (node.type === 'table' && Array.isArray(node.columns)) {
        for (const column of node.columns as string[]) {
          const key = `report.${node.id}.${column}`;
          if (merged[key] === undefined && HOST_COLUMN_LABELS[column] !== undefined) {
            merged[key] = HOST_COLUMN_LABELS[column];
          }
        }
      }
    }
    return merged;
  }, [report.labels, nodes]);

  const refreshTree = useCallback(async (): Promise<void> => {
    try {
      setTree(await window.electronAPI.getMiniAppRunTree(runId));
    } catch {
      setTree(null);
    }
  }, [runId]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const listing = await window.electronAPI.getMiniAppRunDirectory(
          runId,
          selectedDir,
          page,
          verdictFilter === 'all' ? undefined : (verdictFilter as PackVerdict)
        );
        if (!cancelled) {
          setDirListing(listing);
        }
      } catch {
        if (!cancelled) {
          setDirListing(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [runId, selectedDir, page, verdictFilter, listingTick]);

  const refreshListing = useCallback((): void => {
    setListingTick((tick) => tick + 1);
  }, []);

  const clientListing = useMemo<MiniAppRunDirectoryView>(() => {
    const matching = report.items.filter((item) => verdictFilter === 'all' || item.verdict === verdictFilter);
    const pageCount = Math.max(1, Math.ceil(matching.length / DIRECTORY_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), pageCount);
    return {
      runId,
      prefix: selectedDir,
      page: safePage,
      pageCount,
      totalMatching: matching.length,
      items: matching.slice((safePage - 1) * DIRECTORY_PAGE_SIZE, safePage * DIRECTORY_PAGE_SIZE),
    };
  }, [report.items, verdictFilter, runId, selectedDir, page]);

  const listing = dirListing ?? clientListing;

  const rowModels = useMemo(() => listing.items.map((item) => rowModelOf(item, labels)), [listing, labels]);

  const rootCounts = useMemo(() => tree?.directories.find((dir) => dir.path === '')?.totalCounts ?? null, [tree]);

  const treeDepth = useMemo(
    () => (tree ? Math.max(0, ...tree.directories.map((dir) => dir.path.split('/').filter(Boolean).length)) : 0),
    [tree]
  );

  const navigable = treeDepth > 1 || selectedDir !== '';

  const contextSize = useMemo(() => {
    const root = tree?.directories.find((dir) => dir.path === '');
    if (!root) {
      return null;
    }
    if (verdictFilter !== 'all') {
      return root.totalSizeByVerdict[verdictFilter as 'keep' | 'ask' | 'candidate'];
    }
    const sizes = [root.totalSizeByVerdict.keep, root.totalSizeByVerdict.ask, root.totalSizeByVerdict.candidate];
    return sizes.every((size) => typeof size === 'number') ? (sizes as number[]).reduce((sum, size) => sum + size, 0) : null;
  }, [tree, verdictFilter]);

  const facetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (rootCounts) {
      for (const verdict of VERDICTS) {
        counts.set(verdict, rootCounts[verdict]);
      }
      return counts;
    }
    for (const model of report.items) {
      counts.set(model.verdict, (counts.get(model.verdict) ?? 0) + 1);
    }
    return counts;
  }, [rootCounts, report.items]);

  const facetCountFor = useCallback(
    (bind: string, value: string): number => rowModels.filter((model) => (bind === 'decidedByKind' ? model.decidedByKind : String(model.item.evidence?.[bind] ?? '')) === value).length,
    [rowModels]
  );

  const filteredModels = useMemo(
    () =>
      rowModels.filter(
        (model) =>
          (fieldFilter === null ||
            (fieldFilter.bind === 'decidedByKind'
              ? model.decidedByKind === fieldFilter.value
              : String(model.item.evidence?.[fieldFilter.bind] ?? '') === fieldFilter.value)) &&
          (needle.trim().length === 0 || model.item.relPath.toLowerCase().includes(needle.trim().toLowerCase()))
      ),
    [rowModels, fieldFilter, needle]
  );

  const sortedModels = useMemo(() => {
    const sorted = [...filteredModels].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
      }
      return String(left).localeCompare(String(right));
    });
    if (groupBy !== 'none') {
      sorted.sort((a, b) => groupValue(a, groupBy, labels).localeCompare(groupValue(b, groupBy, labels)));
    }
    return sorted;
  }, [filteredModels, sortKey, groupBy, labels]);
  void selectionMode;

  const groupedRows = useMemo(() => {
    if (groupBy === 'none' || selectionMode) {
      return [{ key: '', models: sortedModels }];
    }
    const groups: { key: string; models: RowModel[] }[] = [];
    for (const model of sortedModels) {
      const key = groupValue(model, groupBy, labels);
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.models.push(model);
      } else {
        groups.push({ key, models: [model] });
      }
    }
    return groups;
  }, [groupBy, selectionMode, sortedModels, labels]);

  const filters = useMemo<PackSurfaceFilter[]>(
    () => [
      {
        id: 'verdict',
        options: VERDICTS.map((verdict) => ({
          value: verdict,
          label: `${labels[`status.${verdict}`] ?? verdict} (${facetCounts.get(verdict) ?? 0})`,
          count: facetCounts.get(verdict) ?? 0,
        })),
      },
      ...nodes
        .filter((node) => node.type === 'select' && typeof node.bind === 'string')
        .map((node) => ({
          id: node.bind as string,
          options: (node.options ?? []).map((option) => ({
            value: option,
            label: `${labels[`status.${option}`] ?? option} (${facetCountFor(node.bind as string, option)})`,
            count: facetCountFor(node.bind as string, option),
          })),
        })),
    ],
    [nodes, labels, facetCounts, facetCountFor]
  );

  const askCount = rootCounts ? rootCounts.ask : report.items.filter((item) => item.verdict === 'ask').length;
  const armCandidateCount = rootCounts ? rootCounts.candidate : report.items.filter((item) => item.verdict === 'candidate').length;

  useLayoutEffect(() => {
    const element = paneRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setWidthClass(paneWidthClass(width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    selectionRef.current = selectionMode;
  }, [selectionMode]);

  const closeDrawer = useCallback(() => {
    setDrawerPath(null);
    const restoreTarget = restoreFocusRef.current;
    restoreFocusRef.current = null;
    window.setTimeout(() => restoreTarget?.focus(), 0);
  }, []);

  const openDrawer = useCallback((item: MiniAppRunItemView, element: HTMLElement) => {
    restoreFocusRef.current = element;
    setDrawerPath(item.relPath);
  }, []);

  const exitSelection = useCallback((): void => {
    if (selectionRef.current) {
      setSelectionMode(false);
      setSelectedPaths(new Set());
    }
  }, []);

  useEscapeTo(exitSelection);

  const toggleRow = useCallback((path: string, shiftKey: boolean): void => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (shiftKey && lastToggledRef.current !== null) {
        const paths = sortedModels.map((model) => model.item.relPath);
        const from = paths.indexOf(lastToggledRef.current);
        const to = paths.indexOf(path);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let index = start; index <= end; index += 1) {
            next.add(paths[index]);
          }
          lastToggledRef.current = path;
          return next;
        }
      }
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      lastToggledRef.current = path;
      return next;
    });
  }, [sortedModels]);

  const toggleAllPage = useCallback(
    (select: boolean): void => {
      setSelectedPaths((current) => {
        const next = new Set(current);
        for (const model of sortedModels) {
          if (select) {
            next.add(model.item.relPath);
          } else {
            next.delete(model.item.relPath);
          }
        }
        return next;
      });
    },
    [sortedModels]
  );

  const afterScopedWrite = useCallback(async (): Promise<void> => {
    setSelectedPaths(new Set());
    setSelectionMode(false);
    setScopedConfirm(null);
    refreshListing();
    await refreshTree();
    await onReportChanged?.();
  }, [refreshListing, refreshTree, onReportChanged]);

  const runScoped = useCallback(
    async (dir: string, action: 'keep' | 'exclude'): Promise<void> => {
      let remaining = 1;
      let guard = 0;
      while (remaining > 0 && guard < 100) {
        const result = await window.electronAPI.overrideMiniAppPrefix(runId, dir, 'keep', action === 'keep' ? 'override' : 'exclude', PREFIX_MAX_ITEMS);
        if (!result) {
          break;
        }
        remaining = result.remaining;
        guard += 1;
      }
      await afterScopedWrite();
    },
    [runId, afterScopedWrite]
  );

  const folderCount = listing ? listing.totalMatching : report.items.length;

  const contextFacts = interpolate(TEXT.MINIAPPS_DIR_CONTEXT, {
    root: TEXT.MINIAPPS_TREE_ROOT,
    files: interpolate(TEXT.MINIAPPS_DIR_CONTEXT_FILES, { count: String(folderCount) }),
    size: contextSize !== null ? humanBytes(contextSize) : '—',
    ask: `${askCount} ${labels['status.ask'] ?? 'ask'}`,
  });

  const startScoped = useCallback(
    (dir: string, action: 'keep' | 'exclude'): void => {
      setScopedConfirm({ dir, count: folderCount, action });
    },
    [folderCount]
  );

  const applyBatch = useCallback(
    async (action: PackOverrideAction): Promise<void> => {
      const paths = [...selectedPaths];
      const verdict: 'keep' | 'ask' | 'candidate' = action === 'exclude' ? 'keep' : action;
      const source: 'override' | 'exclude' = action === 'exclude' ? 'exclude' : 'override';
      for (let index = 0; index < paths.length; index += BULK_BATCH_SIZE) {
        await window.electronAPI.overrideMiniAppItems(runId, paths.slice(index, index + BULK_BATCH_SIZE), verdict, source);
      }
      await afterScopedWrite();
    },
    [runId, selectedPaths, afterScopedWrite]
  );

  const selectAllFolder = useCallback(async (): Promise<void> => {
    const limit = Math.min(folderCount, BULK_BATCH_SIZE);
    const selected = new Set(selectedPaths);
    for (let page = 1; selected.size < limit; page += 1) {
      try {
        const listing = await window.electronAPI.getMiniAppRunDirectory(
          runId,
          selectedDir,
          page,
          verdictFilter === 'all' ? undefined : (verdictFilter as PackVerdict)
        );
        if (!listing || listing.items.length === 0) {
          break;
        }
        for (const item of listing.items) {
          selected.add(item.relPath);
          if (selected.size >= limit) {
            break;
          }
        }
        if (listing.page >= listing.pageCount) {
          break;
        }
      } catch {
        break;
      }
    }
    setSelectedPaths(selected);
  }, [folderCount, runId, selectedDir, verdictFilter, selectedPaths]);

  const addKeepRule = useCallback(
    async (dir: string): Promise<void> => {
      const glob = `${dir}/**`;
      const state = await window.electronAPI.getMiniApps();
      const view = state.packs.find((pack) => pack.id === packId);
      const keepKey = view?.ruleBindings?.find((binding) => binding.list === 'keep')?.configKey;
      if (!view || !keepKey) {
        return;
      }
      const existing = Array.isArray(view.configValues[keepKey]) ? (view.configValues[keepKey] as string[]) : [];
      await window.electronAPI.saveMiniAppConfig(packId, {
        ...view.configValues,
        [keepKey]: existing.includes(glob) ? existing : [...existing, glob],
      });
    },
    [packId]
  );

  const drawerItem = drawerPath !== null ? (report.items.find((item) => item.relPath === drawerPath) ?? (dirListing ? dirListing.items.find((item) => item.relPath === drawerPath) ?? null : null)) : null;

  const handleOverride = useCallback(
    async (relPath: string, action: PackOverrideAction): Promise<void> => {
      await onOverride(relPath, action);
      refreshListing();
      await refreshTree();
      await onReportChanged?.();
    },
    [onOverride, refreshListing, refreshTree, onReportChanged]
  );

  const stopRun = useCallback(async (): Promise<void> => {
    await window.electronAPI.cancelMiniAppRun(report.run.id).catch(() => ({ ok: false as const, error: 'unavailable' }));
    await onReportChanged?.();
  }, [report.run.id, onReportChanged]);

  const restartRun = useCallback(async (): Promise<void> => {
    await window.electronAPI.startMiniAppRun(report.run.packId, report.run.rootPath).catch(() => ({ ok: false as const, error: 'unavailable' }));
    await onReportChanged?.();
  }, [report.run.packId, report.run.rootPath, onReportChanged]);

  const onAction = (action: PackSurfaceAction): void => {
    if (action.id === 'run:export') {
      void onExport();
      return;
    }
    if (action.rowId === undefined) {
      return;
    }
    if (action.id === 'item:reveal') {
      void onReveal(action.rowId);
    } else if (action.id === 'item:open') {
      void onOpen(action.rowId);
    } else if (action.id === 'item:restore') {
      void onRestore(action.rowId);
    }
  };

  const toggleDir = useCallback((path: string): void => {
    setSelectedDir(path);
    setPage(1);
    setExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path) && path !== '') {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const tabItems = [
    { value: 'overview', label: TEXT.MINIAPPS_TAB_OVERVIEW },
    { value: 'files', label: TEXT.MINIAPPS_TAB_FILES },
    { value: 'review', label: interpolate(TEXT.MINIAPPS_TAB_REVIEW_COUNT, { count: String(askCount) }) },
  ];

  const breadcrumbs = useMemo(() => {
    const segments = selectedDir.split('/').filter(Boolean);
    return segments.map((segment, index) => ({
      name: segment,
      path: segments.slice(0, index + 1).join('/'),
    }));
  }, [selectedDir]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="pack-report">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span data-testid="report-status-badge" className="inline-flex items-center gap-1.5 text-xs text-[var(--as-muted-foreground)]">
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT_CLASS[report.run.status] ?? 'bg-[var(--as-muted-foreground)]'}`} />
          {runStatusLabel(report.run.status)}
        </span>
        <RunSummary
          run={{
            status: report.run.status,
            startedAt: report.run.startedAt,
            finishedAt: report.run.finishedAt,
            engineId: report.run.engineId,
            execution: report.run.execution,
            actualCalls: report.run.actualCalls,
            estimateCalls: report.run.estimateCalls,
            inputTokens: report.run.inputTokens,
            outputTokens: report.run.outputTokens,
          }}
        />
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <RunActions
            status={report.run.status}
            onStop={report.run.status === 'running' || report.run.status === 'queued' ? () => void stopRun() : undefined}
            onRestart={report.run.status === 'running' || report.run.status === 'queued' ? undefined : () => void restartRun()}
          />
          {report.canArm && onArm && (
            <Button
              size="sm"
              variant="outline"
              data-testid="report-arm"
              disabled={armCandidateCount === 0}
              className={armCandidateCount === 0 ? 'opacity-50' : undefined}
              onClick={onArm}
            >
              {interpolate(TEXT.MINIAPPS_ARM_COUNTED, { count: String(armCandidateCount) })}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void onExport()}>
            {TEXT.MINIAPPS_RUN_EXPORT_MD}
          </Button>
          {onOpenWindow && (
            <Button size="sm" variant="outline" onClick={onOpenWindow}>
              {TEXT.MINIAPPS_WINDOW_OPEN}
            </Button>
          )}
        </span>
      </div>

      <SegmentedTabs ariaLabel={TEXT.MINIAPPS_TABS_ARIA} items={tabItems} value={tab} onValueChange={(next) => setTab(next as ReportTab)} />

      <div ref={paneRef} className="relative flex min-h-0 flex-1 flex-col">
        <div role="tabpanel" aria-label={tabItems.find((entry) => entry.value === tab)?.label} className="flex min-h-0 flex-1 flex-col">
          {tab === 'overview' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OverviewTab report={report} nodes={overviewNodes} tree={tree} />
            </div>
          )}
          {tab === 'files' && (
            <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="report-files-pane">
              <div data-testid="report-toolbar-row-1" className="flex shrink-0 flex-wrap items-center gap-2">
                <SearchInput
                  value={needle}
                  onChange={setNeedle}
                  placeholder={TEXT.MINIAPPS_REPORT_SEARCH}
                  ariaLabel={TEXT.MINIAPPS_REPORT_SEARCH_LABEL}
                  clearLabel={TEXT.MINIAPPS_REPORT_SEARCH}
                  className="min-w-[10rem] flex-1"
                />
                <span data-testid="report-sort" role="group" aria-label={TEXT.MINIAPPS_SORT_ARIA} className="flex items-center gap-1.5 text-xs">
                  <span className="text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_SORT_ARIA}</span>
                  <Combobox
                    hideLabel
                    options={SORT_KEYS.map((key) => ({ value: key, label: SORT_LABELS[key] }))}
                    value={sortKey}
                    onChange={(value) => setSortKey(value as SortKey)}
                    className="w-32"
                  />
                </span>
                <span data-testid="report-group" role="group" aria-label={TEXT.MINIAPPS_GROUP_ARIA} className="flex items-center gap-1.5 text-xs">
                  <span className="text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_GROUP_ARIA}</span>
                  <Combobox
                    hideLabel
                    options={GROUP_KEYS.map((key) => ({ value: key, label: GROUP_LABELS[key] }))}
                    value={groupBy}
                    onChange={(value) => setGroupBy(value as GroupKey)}
                    className="w-36"
                  />
                </span>
                <Button
                  size="sm"
                  variant={selectionMode ? 'default' : 'outline'}
                  data-testid="report-select-toggle"
                  aria-pressed={selectionMode}
                  onClick={() => {
                    if (selectionMode) {
                      exitSelection();
                    } else {
                      setSelectionMode(true);
                    }
                  }}
                >
                  {TEXT.MINIAPPS_SELECT_TOGGLE}
                </Button>
              </div>
              <div data-testid="report-toolbar-row-2" className="shrink-0">
                <PackSurfaceRenderer
                  surface={{ nodes: filesNodes, rows: [] }}
                  labels={labels}
                  filters={filters}
                  activeFilters={{
                    ...(verdictFilter !== 'all' ? { verdict: verdictFilter } : {}),
                    ...(fieldFilter !== null ? { [fieldFilter.bind]: fieldFilter.value } : {}),
                  }}
                  onFilterChange={(facetId, value) => {
                    if (facetId === 'verdict') {
                      setVerdictFilter(value ?? 'all');
                      setPage(1);
                    } else {
                      setFieldFilter(value === null ? null : { bind: facetId, value });
                    }
                  }}
                  onAction={onAction}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                />
              </div>
              <div data-testid="report-context-line" className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
                {navigable ? (
                  <>
                    <button
                      type="button"
                      data-testid="dir-crumb-root"
                      onClick={() => {
                        setSelectedDir('');
                        setPage(1);
                      }}
                      className="rounded px-1 hover:bg-[var(--as-muted)]"
                    >
                      {TEXT.MINIAPPS_TREE_ROOT}
                    </button>
                    {breadcrumbs.map((crumb) => (
                      <span key={crumb.path} className="flex items-center gap-1.5">
                        <span aria-hidden>/</span>
                        <button
                          type="button"
                          data-testid={`dir-crumb-${crumb.path}`}
                          onClick={() => {
                            setSelectedDir(crumb.path);
                            setPage(1);
                          }}
                          className="rounded px-1 font-mono hover:bg-[var(--as-muted)]"
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-[var(--as-muted-foreground)]" data-testid="report-context-facts">
                    {contextFacts}
                  </span>
                )}
                <span
                  role="group"
                  aria-label={TEXT.MINIAPPS_DIR_ACTIONS_ARIA}
                  data-testid="dir-actions"
                  className="ml-auto flex flex-wrap items-center gap-1 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface)]/60 px-1.5 py-1"
                >
                  <Button size="sm" variant="ghost" data-testid="dir-keep-all" onClick={() => startScoped(selectedDir, 'keep')}>
                    {TEXT.MINIAPPS_DIR_KEEP_ALL}
                  </Button>
                  <Button size="sm" variant="ghost" data-testid="dir-exclude-all" onClick={() => startScoped(selectedDir, 'exclude')}>
                    {TEXT.MINIAPPS_DIR_EXCLUDE_ALL}
                  </Button>
                  {(navigable ? selectedDir !== '' : true) && (
                    <Button size="sm" variant="ghost" data-testid="dir-add-rule" onClick={() => void addKeepRule(selectedDir)}>
                      {interpolate(TEXT.MINIAPPS_DIR_ADD_RULE, { glob: selectedDir === '' ? '**' : `${selectedDir}/**` })}
                    </Button>
                  )}
                </span>
              </div>
              {scopedConfirm && (
                <ScopedActionConfirm
                  dir={scopedConfirm.dir}
                  count={scopedConfirm.count}
                  action={scopedConfirm.action}
                  onConfirm={() => void runScoped(scopedConfirm.dir, scopedConfirm.action)}
                  onCancel={() => setScopedConfirm(null)}
                />
              )}
              <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row" data-testid="report-files-body">
                {navigable && tree && (
                  <DirectoryTree
                    tree={tree}
                    selectedDir={selectedDir}
                    expanded={expandedDirs}
                    onToggle={toggleDir}
                    verdictFilter={verdictFilter}
                    labels={labels}
                  />
                )}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                  {selectionMode && (
                    <BulkBar
                      count={selectedPaths.size}
                      folderCount={folderCount}
                      onApply={(action) => void applyBatch(action)}
                      onSelectAllFolder={() => void selectAllFolder()}
                      onDone={exitSelection}
                    />
                  )}
                  <div data-testid="report-files-scroll" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
                  {tableNode && (
                    <div className="space-y-1">
                      {groupedRows.map((group) => (
                        <div key={group.key || 'all'} className="space-y-1">
                          {group.key !== '' && (
                            <h4 className="flex items-center gap-2 pt-2 text-xs font-medium" data-testid={`report-group-heading-${group.key}`}>
                              {labels[`status.${group.key}`] ?? group.key}
                              <span className="text-[var(--as-muted-foreground)]">{group.models.length}</span>
                            </h4>
                          )}
                          <FilesTable
                            rows={group.models}
                            onOverride={handleOverride}
                            labels={labels}
                            tableNodeId={tableNode.id}
                            onOpenDrawer={openDrawer}
                            selectedPath={drawerPath}
                            selectionMode={selectionMode}
                            selectedPaths={selectedPaths}
                            onToggleRow={toggleRow}
                            onToggleAllPage={toggleAllPage}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                  {listing && listing.pageCount > 1 && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                      <Button size="sm" variant="outline" disabled={listing.page <= 1} onClick={() => setPage(listing.page - 1)} data-testid="dir-prev">
                        {TEXT.MINIAPPS_DIR_PREV}
                      </Button>
                      <span className="text-[var(--as-muted-foreground)]" data-testid="dir-page-status">
                        {interpolate(TEXT.MINIAPPS_DIR_PAGE_STATUS, {
                          page: String(listing.page),
                          pageCount: String(listing.pageCount),
                          count: String(listing.totalMatching),
                          dir: selectedDir || TEXT.MINIAPPS_TREE_ROOT,
                        })}
                      </span>
                      <Button size="sm" variant="outline" disabled={listing.page >= listing.pageCount} onClick={() => setPage(listing.page + 1)} data-testid="dir-next">
                        {TEXT.MINIAPPS_DIR_NEXT}
                      </Button>
                    </div>
                  )}
                  {!dirListing && report.itemsTruncated !== undefined && report.itemsTruncated > 0 && (
                    <p role="status" className="shrink-0 text-xs text-[var(--as-muted-foreground)]">
                      {surfaceTruncatedLabel(report.itemsTruncated)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          {tab === 'review' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ReviewTab runId={runId} onOverride={handleOverride} />
            </div>
          )}
        </div>

        {drawerItem && (
          <PackItemDrawer
            item={drawerItem}
            labels={labels}
            variant={widthClass === 'sm' ? 'sheet' : 'side'}
            onClose={closeDrawer}
            onOverride={handleOverride}
            onReveal={onReveal}
            onOpen={onOpen}
            onRestore={onRestore}
          />
        )}
      </div>
    </div>
  );
}
