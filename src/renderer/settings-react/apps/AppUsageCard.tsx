import { useCallback, useEffect, useState, type JSX } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AppUsageStats, AppUsageRow } from '@shared/toolUsage';
import { TEXT, interpolate } from '@shared/constants/text';

type WindowKey = 7 | 30 | null;

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 7, label: '7d' },
  { key: 30, label: '30d' },
  { key: null, label: 'all' },
];

export function AppUsageCard(): JSX.Element {
  const [windowKey, setWindowKey] = useState<WindowKey>(30);
  const [stats, setStats] = useState<AppUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (key: WindowKey): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      setStats(await window.electronAPI.getAppUsageStats(key));
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
    <section aria-label={TEXT.APPS_USAGE_TITLE} className="space-y-2.5 rounded-xl border border-[var(--as-border)] p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{TEXT.APPS_USAGE_TITLE}</h3>
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
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_USAGE_HINT}</p>

      {error ? (
        <p role="alert" className="text-xs text-[var(--as-danger)]">
          {TEXT.USAGE_ERROR}
        </p>
      ) : loading ? (
        <p role="status" className="text-xs text-[var(--as-muted-foreground)]">
          {TEXT.USAGE_LOADING}
        </p>
      ) : !stats || stats.rows.length === 0 ? (
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_USAGE_EMPTY}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={TEXT.APPS_USAGE_TITLE}>
          {stats.rows.map((row) => (
            <AppUsageRowView key={row.app} row={row} maxTotal={maxTotal} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AppUsageRowView({ row, maxTotal }: { row: AppUsageRow; maxTotal: number }): JSX.Element {
  const share = Math.round((row.total / maxTotal) * 100);
  return (
    <li className="rounded-lg border border-[var(--as-border)] px-2 py-1.5 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate font-medium" title={row.app}>
          {row.app}
        </span>
        <span className="ml-auto shrink-0 tabular-nums opacity-70">{row.total}</span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--as-muted)]"
        role="meter"
        aria-valuenow={row.total}
        aria-valuemin={0}
        aria-valuemax={maxTotal}
        aria-label={interpolate(TEXT.APPS_USAGE_BAR_LABEL, { app: row.app, count: row.total })}
      >
        <div className="h-full rounded-full bg-[var(--as-primary)]" style={{ width: `${Math.max(4, share)}%` }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] opacity-60">
        <span>{interpolate(TEXT.USAGE_OK, { count: row.ok })}</span>
        {row.errors > 0 && <span className="text-[var(--as-danger)]">{interpolate(TEXT.USAGE_ERRORS, { count: row.errors })}</span>}
        {row.denied > 0 && <span>{interpolate(TEXT.USAGE_DENIED, { count: row.denied })}</span>}
        <span>{interpolate(TEXT.USAGE_AVG, { ms: row.avgDurationMs })}</span>
      </div>
    </li>
  );
}
