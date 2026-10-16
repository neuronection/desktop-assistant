import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT, interpolate } from '@shared/constants/text';
import {
  PACK_REPORT_COMPONENTS,
  PACK_RUN_ACTIONS,
  PACK_ITEM_ACTIONS,
} from '@shared/app-pack';
import type {
  PackSurfaceAction,
  PackSurfaceFilter,
  PackSurfaceNode,
  PackSurfaceRow,
  PackSurfaceView,
} from '@shared/app-pack';

export const SURFACE_PAGE_SIZE = 50;

/** Canonical node render order (family fixture contract, case stat-badge-progress-binds). */
export const SURFACE_NODE_ORDER = ['stat', 'badge', 'progress', 'filter-bar', 'select', 'actions', 'table', 'cards'] as const;

const RUN_ACTION_IDS: readonly string[] = PACK_RUN_ACTIONS;
const ITEM_ACTION_IDS: readonly string[] = PACK_ITEM_ACTIONS;

export function isSurfaceActionId(id: string): boolean {
  return RUN_ACTION_IDS.includes(id) || ITEM_ACTION_IDS.includes(id);
}

/** Dot-walk a bind path into the values object; undefined when any hop is missing. */
export function surfaceBindValue(values: Record<string, unknown> | undefined, bind: string | undefined): unknown {
  if (!bind || !values) {
    return undefined;
  }
  let node: unknown = values;
  for (const part of bind.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Progress semantics: `{done,total}` shapes, raw percents clamped 0–100, missing ⇒ 0. */
export function surfaceProgressPercent(value: unknown): number {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (value !== null && typeof value === 'object') {
    const shape = value as Record<string, unknown>;
    const done = typeof shape.done === 'number' ? shape.done : null;
    const total = typeof shape.total === 'number' ? shape.total : null;
    if (done !== null && total !== null) {
      const pct = total > 0 ? (done / total) * 100 : 0;
      return Math.max(0, Math.min(100, Math.round(pct)));
    }
  }
  return 0;
}

function valueText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The closed-vocabulary surface core (ADR-0040 clause 16 / plan 32
 * Phase 4): renders the family fixture contract — desktop's own
 * implementation, parity-pinned by `contracts/surface-renderer.fixtures.json`
 * (implementations may differ, outputs may not). Unknown node types and
 * unknown action ids never render (defense-in-depth behind manifest
 * validation); raw markup from an extension never mounts — every string
 * lands as React text.
 */
export function PackSurfaceRenderer({
  surface,
  labels,
  filters,
  activeFilters,
  onFilterChange,
  onAction,
  truncatedLabel,
}: {
  surface: PackSurfaceView;
  labels?: Record<string, string>;
  /** filter-bar facet definitions (the schema node only ids them). */
  filters?: PackSurfaceFilter[];
  /** Controlled facet selections (`{ facetId: value }`; '' / absent = all). */
  activeFilters?: Record<string, string>;
  onFilterChange?: (facetId: string, value: string | null) => void;
  onAction?: (action: PackSurfaceAction) => void;
  /** Host-resolved truncation notice (renders `role=status` when set). */
  truncatedLabel?: string;
}): ReactElement {
  const [visibleCount, setVisibleCount] = useState(SURFACE_PAGE_SIZE);
  const nodes = useMemo(
    () => (Array.isArray(surface.nodes) ? surface.nodes.filter((node) => (PACK_REPORT_COMPONENTS as readonly string[]).includes(node.type)) : []),
    [surface.nodes]
  );
  const rows = useMemo(() => (Array.isArray(surface.rows) ? surface.rows : []), [surface.rows]);
  useEffect(() => {
    setVisibleCount(SURFACE_PAGE_SIZE);
  }, [surface.rows]);
  const visibleRows = rows.slice(0, visibleCount);
  const facetDefs = useMemo(() => {
    const map = new Map<string, PackSurfaceFilter>();
    for (const filter of filters ?? []) {
      map.set(filter.id, filter);
    }
    return map;
  }, [filters]);

  const label = (key: string, fallback: string): string => labels?.[key] || fallback;
  const knownActions = (ids: readonly string[] | undefined): string[] => (ids ?? []).filter(isSurfaceActionId);
  const fire = (id: string, rowId?: string): void => onAction?.({ id: id as PackSurfaceAction['id'], ...(rowId !== undefined ? { rowId } : {}) });

  const actionButton = (id: string, rowId?: string): ReactElement => {
    const testId = rowId !== undefined ? `surface-action-${id}-${rowId}` : `surface-action-${id}`;
    return (
      <Button key={testId} size="sm" variant="outline" data-testid={testId} onClick={() => fire(id, rowId)}>
        {label(`action.${id}`, id)}
      </Button>
    );
  };

  const rowEvidence = (rowId: string, evidence: unknown, summary?: string): ReactElement | null => {
    if (evidence === undefined || evidence === null) {
      return null;
    }
    const heading = summary !== undefined && summary.length > 0 ? `${TEXT.MINIAPPS_REPORT_EVIDENCE} \u2014 ${summary}` : TEXT.MINIAPPS_REPORT_EVIDENCE;
    return (
      <details data-testid={`surface-evidence-${rowId}`} className="mt-0.5">
        <summary className="cursor-pointer text-[11px] text-[var(--as-muted-foreground)]">{heading}</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-[var(--as-muted)] p-2 text-[11px] whitespace-pre-wrap">{JSON.stringify(evidence, null, 2)}</pre>
      </details>
    );
  };

  const cellValue = (row: PackSurfaceRow, column: string): ReactNode => {
    if (row.badgeField === column && row.badge !== undefined) {
      return (
        <Badge variant="outline" data-testid={`surface-badge-${row.id}-${column}`} className="text-[10px]">
          {row.badge}
        </Badge>
      );
    }
    return valueText(row.values?.[column]);
  };

  const groupHeading = (key: string): string => surface.groups?.[key] ?? label(`status.${key}`, key);

  const cardsFor = (items: PackSurfaceRow[]): ReactElement[] =>
    items.map((row) => (
      <li key={row.id} data-testid={`surface-row-${row.id}`} className="rounded-md border border-[var(--as-border)] px-2.5 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium" title={row.title ?? undefined}>
            {row.title ?? row.id}
          </span>
          {row.badge !== undefined && (
            <Badge variant="outline" className="text-[10px]">
              {row.badge}
            </Badge>
          )}
          {row.meta?.map((segment, index) => (
            <span key={`${row.id}-meta-${index}`} className="text-[var(--as-muted-foreground)]">
              {segment}
            </span>
          ))}
          {knownActions(row.actions).length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              {knownActions(row.actions).map((id) => actionButton(id, row.id))}
            </span>
          )}
        </div>
        {rowEvidence(row.id, row.evidence, row.evidenceSummary)}
      </li>
    ));

  const groupedSections = (node: PackSurfaceNode): ReactElement[] => {
    const seen: string[] = [];
    for (const row of visibleRows) {
      const key = row.group ?? '';
      if (!seen.includes(key)) {
        seen.push(key);
      }
    }
    return seen.map((key) => {
      const items = visibleRows.filter((row) => (row.group ?? '') === key);
      if (items.length === 0) {
        return null as unknown as ReactElement;
      }
      const heading = groupHeading(key);
      return (
        <section key={key || 'all'} aria-label={heading || label(`report.${node.id}`, node.id)} className="space-y-1.5">
          {key !== '' && (
            <h4 className="flex items-center gap-2 text-xs font-medium">
              {heading}
              <span className="text-[var(--as-muted-foreground)]">{items.length}</span>
            </h4>
          )}
          <ul className="space-y-1.5">{cardsFor(items)}</ul>
        </section>
      );
    });
  };

  const renderNode = (node: PackSurfaceNode): ReactElement | null => {
    const nodeLabel = label(`report.${node.id}`, node.id);
    switch (node.type) {
      case 'stat': {
        const value = valueText(surfaceBindValue(surface.values, node.bind));
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="rounded-xl border border-[var(--as-border)] px-3 py-2">
            <div className="text-lg font-medium">{value.length > 0 ? value : '\u2014'}</div>
            <div className="text-[11px] text-[var(--as-muted-foreground)]">{nodeLabel}</div>
          </div>
        );
      }
      case 'badge': {
        const value = valueText(surfaceBindValue(surface.values, node.bind));
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--as-muted-foreground)]">{nodeLabel}</span>
            <Badge variant="outline" className="text-[10px]">
              {value.length > 0 ? value : '\u2014'}
            </Badge>
          </div>
        );
      }
      case 'progress': {
        const percent = surfaceProgressPercent(surfaceBindValue(surface.values, node.bind));
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="space-y-1">
            <span className="text-xs text-[var(--as-muted-foreground)]">{nodeLabel}</span>
            <div
              role="progressbar"
              aria-label={nodeLabel}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]"
            >
              <div className="h-full rounded-full bg-[var(--as-primary)]" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      }
      case 'filter-bar': {
        const facets = (node.filters ?? [])
          .map((facetId) => facetDefs.get(facetId))
          .filter((facet): facet is PackSurfaceFilter => facet !== undefined);
        if (facets.length === 0) {
          return null;
        }
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="flex flex-wrap items-center gap-2">
            {facets.map((facet) => {
              const active = activeFilters?.[facet.id] ?? '';
              return (
                <span key={facet.id} className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid={`surface-filter-${facet.id}-all`}
                    aria-pressed={active === '' || active === 'all'}
                    onClick={() => onFilterChange?.(facet.id, null)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      active === '' || active === 'all' ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
                    }`}
                  >
                    {TEXT.MINIAPPS_REPORT_FILTER_ALL}
                  </button>
                  {facet.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      data-testid={`surface-filter-${facet.id}-${option.value}`}
                      aria-pressed={active === option.value}
                      onClick={() => onFilterChange?.(facet.id, option.value)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        active === option.value ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10' : 'border-[var(--as-border)]'
                      }`}
                    >
                      {option.label ?? label(`status.${option.value}`, option.value)}
                    </button>
                  ))}
                </span>
              );
            })}
          </div>
        );
      }
      case 'select': {
        const options = Array.isArray(node.options) ? node.options : [];
        if (options.length === 0) {
          return null;
        }
        const facetId = node.bind ?? node.id;
        const facet = facetDefs.get(facetId);
        const active = activeFilters?.[facetId] ?? '';
        return (
          <label key={node.id} data-testid={`surface-${node.id}`} className="flex items-center gap-2 text-xs">
            <span className="text-[var(--as-muted-foreground)]">{nodeLabel}</span>
            <select
              data-testid={`surface-select-${facetId}`}
              className="rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1 text-xs"
              value={active}
              onChange={(event) => onFilterChange?.(facetId, event.target.value === '' ? null : event.target.value)}
            >
              <option value="">{TEXT.MINIAPPS_REPORT_FILTER_ALL}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {facet?.options.find((candidate) => candidate.value === option)?.label ?? label(`status.${option}`, option)}
                </option>
              ))}
            </select>
          </label>
        );
      }
      case 'actions': {
        const actions = knownActions(node.actions);
        if (actions.length === 0) {
          return null;
        }
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="flex flex-wrap items-center gap-2">
            {actions.map((id) => actionButton(id))}
          </div>
        );
      }
      case 'table': {
        const columns = Array.isArray(node.columns) ? node.columns : [];
        if (columns.length === 0) {
          return null;
        }
        return (
          <table key={node.id} data-testid={`surface-${node.id}`} className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--as-border)] text-left text-[var(--as-muted-foreground)]">
                {columns.map((column) => (
                  <th key={column} scope="col" className="py-1.5 pr-3 font-medium">
                    {label(`report.${node.id}.${column}`, column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} data-testid={`surface-row-${row.id}`} className="border-b border-[var(--as-border)]/50 align-top">
                  {columns.map((column, columnIndex) => (
                    <td key={column} data-testid={`surface-cell-${row.id}-${column}`} className="py-1.5 pr-3">
                      <div className="max-w-md min-w-0">
                        <span className="block truncate" title={valueText(row.values?.[column])}>
                          {cellValue(row, column)}
                        </span>
                        {columnIndex === 0 && rowEvidence(row.id, row.evidence, row.evidenceSummary)}
                      </div>
                    </td>
                  ))}
                  {knownActions(row.actions).length > 0 && (
                    <td className="py-1.5 align-top">
                      <span className="flex items-center gap-1">
                        {knownActions(row.actions).map((id) => actionButton(id, row.id))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      case 'cards': {
        if (node.of !== 'groups') {
          return (
            <div key={node.id} data-testid={`surface-${node.id}`} className="space-y-3">
              <section aria-label={nodeLabel} className="space-y-1.5">
                <ul className="space-y-1.5">{cardsFor(visibleRows)}</ul>
              </section>
            </div>
          );
        }
        return (
          <div key={node.id} data-testid={`surface-${node.id}`} className="space-y-3">
            {groupedSections(node)}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div data-testid="surface" className="space-y-4">
      {SURFACE_NODE_ORDER.flatMap((type) => nodes.filter((node) => node.type === type).map(renderNode))}

      {truncatedLabel !== undefined && truncatedLabel.length > 0 && (
        <p role="status" data-testid="surface-truncated" className="text-xs text-[var(--as-muted-foreground)]">
          {truncatedLabel}
        </p>
      )}

      {rows.length > visibleRows.length && (
        <Button size="sm" variant="outline" data-testid="surface-load-more" onClick={() => setVisibleCount((count) => count + SURFACE_PAGE_SIZE)}>
          {TEXT.MINIAPPS_REPORT_LOAD_MORE}
        </Button>
      )}
    </div>
  );
}

export function surfaceTruncatedLabel(count: number): string {
  return interpolate(TEXT.MINIAPPS_REPORT_TRUNCATED, { count: String(count) });
}
