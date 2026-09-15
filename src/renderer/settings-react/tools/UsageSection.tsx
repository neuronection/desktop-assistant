import { useCallback, useEffect, useState, type JSX } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ToolUsageStats, ToolUsageRow } from '@shared/toolUsage';
import { TEXT, interpolate } from '@shared/constants/text';

type WindowKey = 7 | 30 | null;

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: null, label: 'all' },
];

function shortTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface UsageSectionProps {
  className?: string;
}

/** Reads the tool_calls audit (read-only IPC). Bars are plain CSS — no chart lib. */
export function UsageSection(_props: UsageSectionProps): JSX.Element {
  const [windowKey, setWindowKey] = useState<WindowKey>(30);
  const [stats, setStats] = useState<ToolUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (key: WindowKey): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      setStats(await window.electronAPI.getToolUsageStats(key));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(windowKey);
  }, [windowKey, load]);

  const maxTotal = Math.max(1, ...(stats?.rows.map((row) => row.total) ?? [1]));

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">{TEXT.USAGE_TITLE}</h4>
        <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label={TEXT.USAGE_WINDOW}>
          {WINDOWS.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="radio"
              aria-checked={windowKey === entry.key}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                windowKey === entry.key
                  ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10 text-[var(--as-primary)]'
                  : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
              }`}
              onClick={() => setWindowKey(entry.key)}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            aria-label={TEXT.USAGE_REFRESH}
            className="ml-1 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
            onClick={() => void load(windowKey)}
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </div>
      <p className="text-xs opacity-60">{TEXT.USAGE_HINT}</p>

      {error ? (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {TEXT.USAGE_ERROR}
        </p>
      ) : loading ? (
        <p role="status" className="text-xs opacity-60">
          {TEXT.USAGE_LOADING}
        </p>
      ) : !stats || stats.rows.length === 0 ? (
        <p className="text-xs opacity-50">{TEXT.USAGE_EMPTY}</p>
      ) : (
        <>
          <ul className="space-y-1.5" aria-label={TEXT.USAGE_TITLE}>
            {stats.rows.map((row) => (
              <UsageRow key={row.tool} row={row} maxTotal={maxTotal} />
            ))}
          </ul>
          <p className="text-[11px] tabular-nums opacity-50">
            {interpolate(TEXT.USAGE_TOTAL, { count: stats.total })}
          </p>
          {stats.recentFailures.length > 0 && (
            <div className="space-y-1 border-t border-[var(--as-border)] pt-2">
              <p className="text-xs font-medium">{TEXT.USAGE_FAILURES}</p>
              <ul className="space-y-0.5">
                {stats.recentFailures.map((failure, index) => (
                  <li key={`${failure.tool}_${failure.at}_${index}`} className="flex items-center gap-2 text-[11px] opacity-70">
                    <span className="w-28 shrink-0 truncate">{shortTime(failure.at)}</span>
                    <span className="shrink-0 font-mono">{failure.tool}</span>
                    <span className="truncate">{failure.outcome}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UsageRow({ row, maxTotal }: { row: ToolUsageRow; maxTotal: number }): JSX.Element {
  const approvals = Object.entries(row.approvals)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} ${count}`)
    .join(', ');
  const share = Math.round((row.total / maxTotal) * 100);
  return (
    <li data-no-drag className="rounded-lg border border-[var(--as-border)] px-2 py-1.5 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-mono" title={row.tool}>
          {row.tool}
        </span>
        <span className="ml-auto shrink-0 tabular-nums opacity-70">{row.total}</span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]"
        role="meter"
        aria-valuenow={row.total}
        aria-valuemin={0}
        aria-valuemax={maxTotal}
        aria-label={interpolate(TEXT.USAGE_BAR_LABEL, { tool: row.tool, count: row.total })}
      >
        <div
          className="da-usage-fill h-full rounded-full bg-[var(--as-primary)]"
          style={{ width: `${Math.max(4, share)}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-60">
        <span>{interpolate(TEXT.USAGE_OK, { count: row.ok })}</span>
        {row.errors > 0 && <span className="text-[var(--as-danger)]">{interpolate(TEXT.USAGE_ERRORS, { count: row.errors })}</span>}
        {row.denied > 0 && <span>{interpolate(TEXT.USAGE_DENIED, { count: row.denied })}</span>}
        <span>{interpolate(TEXT.USAGE_AVG, { ms: row.avgDurationMs })}</span>
        {approvals && <span title={approvals}>· {approvals}</span>}
      </div>
    </li>
  );
}
