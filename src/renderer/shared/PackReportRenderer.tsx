import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { SearchInput } from '@neuronection/assistant-ui/search-input';
import { TEXT, interpolate } from '@shared/constants/text';
import type {
  MiniAppRunItemView,
  MiniAppRunReportView,
  PackSurfaceAction,
  PackSurfaceFilter,
  PackSurfaceNode,
  PackSurfaceRow,
  PackSurfaceView,
} from '@shared/app-pack';
import { runStatusLabel } from './runStatus';
import { PackSurfaceRenderer, surfaceTruncatedLabel } from './PackSurfaceRenderer';

type ReportNode = Record<string, unknown> & { id: string; type: string };

const VERDICTS = ['keep', 'ask', 'candidate'] as const;

const HOST_COLUMN_LABELS: Record<string, string> = {
  path: TEXT.MINIAPPS_REPORT_COL_PATH,
  verdict: TEXT.MINIAPPS_REPORT_COL_VERDICT,
  confidence: TEXT.MINIAPPS_REPORT_COL_CONFIDENCE,
  decidedBy: TEXT.MINIAPPS_REPORT_COL_DECIDED_BY,
};

const HOST_ACTION_LABELS: Record<string, string> = {
  'action.run:export': TEXT.MINIAPPS_RUN_EXPORT_MD,
  'action.item:reveal': TEXT.MINIAPPS_ITEM_REVEAL,
  'action.item:open': TEXT.MINIAPPS_ITEM_OPEN,
  'action.item:restore': TEXT.MINIAPPS_RESTORE_ITEM,
};

function confidenceLabel(item: MiniAppRunItemView): string {
  return item.confidence !== null ? item.confidence.toFixed(2) : '\u2014';
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
    parts.push('user');
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
}

function ReviewQueue({
  report,
  onOverride,
}: {
  report: MiniAppRunReportView;
  onOverride: (relPath: string, action: 'keep' | 'candidate' | 'exclude') => Promise<void>;
}): ReactElement | null {
  const [done, setDone] = useState<Set<string>>(new Set());
  const askItems = useMemo(() => report.items.filter((item) => item.verdict === 'ask' && !done.has(item.relPath)), [report, done]);
  if (askItems.length === 0) {
    return null;
  }
  return (
    <section aria-label={interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(askItems.length) })} className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <h4 className="text-sm font-medium">{interpolate(TEXT.MINIAPPS_REVIEW_TITLE, { count: String(askItems.length) })}</h4>
      <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_REVIEW_HINT}</p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {askItems.map((item) => (
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
    </section>
  );
}

/**
 * The declarative report renderer (plan 26 S5 / ADR-0040 clause 16):
 * host-rendered closed component vocabulary driven by the pack's report
 * schema — never raw pack markup. This adapter maps the run report view
 * onto the family surface view (`PackSurfaceRenderer`, the same core the
 * `ui:window` surface host mounts — parity is pinned by
 * `contracts/surface-renderer.fixtures.json`) and binds the host action
 * funnels (export, reveal/open/restore). The ask-review queue captures
 * overrides that persist for later runs of the same folder.
 */
export function PackReportRenderer({
  report,
  onOverride,
  onReveal,
  onOpen,
  onRestore,
  onExport,
}: {
  report: MiniAppRunReportView;
  onOverride: (relPath: string, action: 'keep' | 'candidate' | 'exclude') => Promise<void>;
  onReveal: (relPath: string) => Promise<void>;
  onOpen: (relPath: string) => Promise<void>;
  onRestore: (relPath: string) => Promise<void>;
  onExport: () => Promise<void>;
}): ReactElement {
  const [verdictFilter, setVerdictFilter] = useState<string>('all');
  const [fieldFilter, setFieldFilter] = useState<{ bind: string; value: string } | null>(null);
  const [needle, setNeedle] = useState('');

  const totals = report.run.totals;
  const surface = useMemo<PackSurfaceView>(() => {
    const nodes = (Array.isArray(report.reportNodes) ? (report.reportNodes as ReportNode[]) : []).map((node) => {
      if ((node.type === 'stat' || node.type === 'badge' || node.type === 'progress') && typeof node.bind !== 'string') {
        return { ...node, bind: 'totals.scanned' };
      }
      if (node.type === 'select' && typeof node.bind !== 'string') {
        return { ...node, bind: 'decidedBy' };
      }
      return node;
    }) as PackSurfaceNode[];
    const rows: PackSurfaceRow[] = report.items.map((item) => ({
      id: item.relPath,
      values: {
        path: item.relPath,
        verdict: item.verdict,
        confidence: confidenceLabel(item),
        decidedBy: item.decidedBy,
      },
      badge: item.verdict,
      badgeField: 'verdict',
      group: item.verdict,
      evidence: item.evidence ?? undefined,
      ...(derivedEvidenceSummary(item, report.labels) !== undefined ? { evidenceSummary: derivedEvidenceSummary(item, report.labels) } : {}),
      actions:
        item.decidedBy === 'quarantined'
          ? ['item:reveal', 'item:open', 'item:restore']
          : ['item:reveal', 'item:open'],
    }));
    const decided = totals ? totals.keep + totals.ask + totals.candidate : null;
    return {
      nodes,
      rows,
      values: {
        run: {
          status: runStatusLabel(report.run.status),
          ...(decided !== null && totals ? { progress: { done: decided, total: totals.scanned } } : {}),
        },
        ...(totals ? { totals: totals as unknown as Record<string, unknown> } : {}),
      },
      groups: { keep: labelOrKey(report.labels, 'keep'), ask: labelOrKey(report.labels, 'ask'), candidate: labelOrKey(report.labels, 'candidate') },
    };
  }, [report]);

  const filters = useMemo<PackSurfaceFilter[]>(
    () => [
      { id: 'verdict', options: VERDICTS.map((verdict) => ({ value: verdict })) },
      ...surface.nodes
        .filter((node) => node.type === 'select' && typeof node.bind === 'string')
        .map((node) => ({
          id: node.bind as string,
          options: (node.options ?? []).map((option) => ({ value: option })),
        })),
    ],
    [surface.nodes]
  );

  const labels = useMemo(() => {
    const merged: Record<string, string> = { ...report.labels };
    for (const node of surface.nodes) {
      if (node.type === 'table' && Array.isArray(node.columns)) {
        for (const column of node.columns) {
          const key = `report.${node.id}.${column}`;
          if (merged[key] === undefined && HOST_COLUMN_LABELS[column] !== undefined) {
            merged[key] = HOST_COLUMN_LABELS[column];
          }
        }
      }
    }
    for (const [key, value] of Object.entries(HOST_ACTION_LABELS)) {
      if (merged[key] === undefined) {
        merged[key] = value;
      }
    }
    return merged;
  }, [report.labels, surface.nodes]);

  const rows = useMemo(
    () =>
      (surface.rows ?? []).filter(
        (row) =>
          (verdictFilter === 'all' || row.values.verdict === verdictFilter) &&
          (fieldFilter === null || String(row.values[fieldFilter.bind] ?? '') === fieldFilter.value) &&
          (needle.trim().length === 0 || row.id.toLowerCase().includes(needle.trim().toLowerCase()))
      ),
    [surface.rows, verdictFilter, fieldFilter, needle]
  );

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

  const hasFilterBar = surface.nodes.some((node) => node.type === 'filter-bar');

  return (
    <div className="space-y-4">
      {hasFilterBar && (
        <SearchInput value={needle} onChange={setNeedle} placeholder={TEXT.MINIAPPS_REPORT_SEARCH} ariaLabel={TEXT.MINIAPPS_REPORT_SEARCH_LABEL} clearLabel={TEXT.MINIAPPS_REPORT_SEARCH} />
      )}

      <PackSurfaceRenderer
        surface={{ ...surface, rows }}
        labels={labels}
        filters={filters}
        activeFilters={{
          ...(verdictFilter !== 'all' ? { verdict: verdictFilter } : {}),
          ...(fieldFilter !== null ? { [fieldFilter.bind]: fieldFilter.value } : {}),
        }}
        onFilterChange={(facetId, value) => {
          if (facetId === 'verdict') {
            setVerdictFilter(value ?? 'all');
          } else {
            setFieldFilter(value === null ? null : { bind: facetId, value });
          }
        }}
        onAction={onAction}
        truncatedLabel={report.itemsTruncated !== undefined && report.itemsTruncated > 0 ? surfaceTruncatedLabel(report.itemsTruncated) : undefined}
      />

      {totals && (
        <p className="text-xs text-[var(--as-muted-foreground)]">
          {interpolate(TEXT.MINIAPPS_REPORT_TOTALS, {
            scanned: String(totals.scanned),
            keep: String(totals.keep),
            ask: String(totals.ask),
            candidate: String(totals.candidate),
          })}
        </p>
      )}

      <ReviewQueue report={report} onOverride={onOverride} />
    </div>
  );
}

function labelOrKey(labels: Record<string, string>, key: string): string {
  return labels[`status.${key}`] ?? key;
}
