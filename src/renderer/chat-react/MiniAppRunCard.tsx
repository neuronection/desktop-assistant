import { useEffect, useMemo, useState, type JSX } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { DEFAULT_LIVE_CARD, type MiniAppLiveCardView, type MiniAppRunMessageMetadata } from '@shared/app-pack';
import { TEXT, interpolate } from '@shared/constants/text';
import { runStatusLabel } from '@renderer/shared/runStatus';

export interface MiniAppRunCardProps {
  run: MiniAppRunMessageMetadata;
  /** Desktop hosts the in-window report; the launcher deep-links into the settings runs area (plan 27 S2). */
  onOpenDetails?: (runId: string, packId: string) => void;
  className?: string;
}

/**
 * Live view of one run, keyed by runId: decide-phase progress
 * (absolute done/total), the estimate, and the streaming status.
 * Totals stay metadata-owned — they settle atomically with the card.
 */
interface RunOverlay {
  status?: string;
  estimateCalls?: number;
  progress?: { done: number; total: number };
  itemsDecided?: number;
}

const TERMINAL_EVENTS = new Set(['run:finished', 'run:failed', 'run:canceled']);

const liveCardCache = new Map<string, MiniAppLiveCardView | null>();
const liveCardPending = new Map<string, Promise<MiniAppLiveCardView | null>>();

function fetchLiveCard(packId: string): Promise<MiniAppLiveCardView | null> {
  if (liveCardCache.has(packId)) {
    return Promise.resolve(liveCardCache.get(packId) ?? null);
  }
  const inflight = liveCardPending.get(packId);
  if (inflight) {
    return inflight;
  }
  const promise = (async (): Promise<MiniAppLiveCardView | null> => {
    try {
      const view = await window.electronAPI.getMiniAppLiveCard?.(packId);
      liveCardCache.set(packId, view ?? null);
      return view ?? null;
    } catch {
      liveCardCache.set(packId, null);
      return null;
    } finally {
      liveCardPending.delete(packId);
    }
  })();
  liveCardPending.set(packId, promise);
  return promise;
}

function defaultLabel(nodeId: string): string | null {
  switch (nodeId) {
    case 'scanned':
      return TEXT.MINIAPPS_LIVE_LABEL_SCANNED;
    case 'keep':
      return TEXT.MINIAPPS_LIVE_LABEL_KEEP;
    case 'ask':
      return TEXT.MINIAPPS_LIVE_LABEL_ASK;
    case 'candidate':
      return TEXT.MINIAPPS_LIVE_LABEL_CANDIDATE;
    case 'progress':
      return TEXT.MINIAPPS_LIVE_LABEL_PROGRESS;
    default:
      return null;
  }
}

function numericValue(bind: string, run: MiniAppRunMessageMetadata): number | null | undefined {
  switch (bind) {
    case 'run.estimateCalls':
      return run.estimateCalls;
    case 'run.actualCalls':
      return run.actualCalls;
    case 'run.inputTokens':
      return run.inputTokens;
    case 'run.outputTokens':
      return run.outputTokens;
    case 'totals.scanned':
      return run.totals?.scanned;
    case 'totals.keep':
      return run.totals?.keep;
    case 'totals.ask':
      return run.totals?.ask;
    case 'totals.candidate':
      return run.totals?.candidate;
    case 'totals.pending':
      return run.totals?.pending;
    default:
      return undefined;
  }
}

/**
 * The live run card (plan 28 S2): resting state is the persisted
 * `miniAppRun` metadata (truthful in history, after restart); while the
 * run is in flight the `miniapps:run-event` broadcast overlays status
 * and decide-phase progress. Rendering is host-owned from the pack's
 * declared `liveCard` nodes (SDK `DEFAULT_LIVE_CARD` otherwise) — the
 * renderer never orchestrates the run.
 */
export function MiniAppRunCard({ run, onOpenDetails, className = '' }: MiniAppRunCardProps): JSX.Element {
  const [spec, setSpec] = useState<MiniAppLiveCardView | null>(liveCardCache.get(run.packId) ?? null);
  const [overlay, setOverlay] = useState<RunOverlay>({});

  useEffect(() => {
    setOverlay({});
    let alive = true;
    void fetchLiveCard(run.packId).then((view) => {
      if (alive) {
        setSpec(view);
      }
    });
    const unsubscribe = window.electronAPI.onMiniAppRunEvent?.((event) => {
      if (event.runId !== run.runId) {
        return;
      }
      setOverlay((current) => {
        if (event.type === 'run:progress' && typeof event.estimateCalls === 'number') {
          return { ...current, estimateCalls: event.estimateCalls };
        }
        if (event.type === 'run:progress' && event.phase === 'decide') {
          return { ...current, progress: { done: event.done ?? 0, total: event.total ?? 0 } };
        }
        if (event.type === 'run:items') {
          return { ...current, itemsDecided: (current.itemsDecided ?? 0) + (event.count ?? 0) };
        }
        if (event.type === 'run:started' || event.type === 'run:paused' || event.type === 'run:resumed') {
          return { ...current, ...(event.status ? { status: event.status } : {}) };
        }
        if (TERMINAL_EVENTS.has(event.type)) {
          return { ...current, ...(event.status ? { status: event.status } : {}) };
        }
        return current;
      });
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [run.runId, run.packId]);

  const nodes = spec?.nodes ?? DEFAULT_LIVE_CARD.nodes;
  const labels = spec?.labels ?? {};
  const status = overlay.status ?? run.status;
  const live = status === 'running' || status === 'queued' || status === 'paused' || status === 'interrupted';

  const progress = useMemo((): { done: number; total: number } | null => {
    if (overlay.progress && overlay.progress.total > 0) {
      return overlay.progress;
    }
    return null;
  }, [overlay.progress]);

  const cost = useMemo(() => {
    const estimate = overlay.estimateCalls ?? run.estimateCalls;
    const actual = run.actualCalls;
    if (actual) {
      const parts = [interpolate(TEXT.MINIAPPS_RUN_CALLS, { count: String(actual) })];
      if (estimate && estimate > 0) {
        parts.push(`≈ ${estimate}`);
      }
      if (run.inputTokens || run.outputTokens) {
        parts.push(interpolate(TEXT.MINIAPPS_RUN_TOKENS, { in: String(run.inputTokens ?? 0), out: String(run.outputTokens ?? 0) }));
      }
      return parts.join(' · ');
    }
    if (estimate && estimate > 0) {
      return interpolate(TEXT.MINIAPPS_RUN_ESTIMATE, { count: String(estimate) });
    }
    return null;
  }, [overlay.estimateCalls, run.estimateCalls, run.actualCalls, run.inputTokens, run.outputTokens]);

  return (
    <div
      data-no-drag
      data-miniapp-run-card
      className={`da-rise flex w-full max-w-xl flex-col gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/80 px-3 py-2.5 ${className}`}
    >
      <div className="flex items-center gap-2">
        {live ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--as-primary)]" aria-hidden /> : <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />}
        <span className="truncate text-xs font-semibold">{run.packTitle}</span>
        <span
          className="ml-auto shrink-0 rounded-full border border-[var(--as-border)] px-1.5 py-px text-[10px] uppercase tracking-wide opacity-80"
          {...(live ? { 'aria-live': 'polite' as const } : {})}
        >
          {runStatusLabel(status)}
        </span>
      </div>

      {nodes.map((node) => {
        if (node.type === 'progress') {
          if (status === 'done' || status === 'failed' || status === 'canceled') {
            return null;
          }
          if (progress) {
            return (
              <div key={node.id} className="flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  aria-label={interpolate(TEXT.MINIAPPS_RUN_PROGRESS, { done: String(progress.done), total: String(progress.total) })}
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--as-muted)]"
                >
                  <div
                    className="h-full rounded-full bg-[var(--as-primary)] transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
                  />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                  {interpolate(TEXT.MINIAPPS_RUN_PROGRESS, { done: String(progress.done), total: String(progress.total) })}
                </span>
              </div>
            );
          }
          return (
            <p key={node.id} className="text-[11px] opacity-70">
              {progress === null && overlay.itemsDecided
                ? interpolate(TEXT.MINIAPPS_LIVE_DECIDED, { count: String(overlay.itemsDecided) })
                : run.totals?.pending
                  ? interpolate(TEXT.MINIAPPS_RUN_PENDING, { count: String(run.totals.pending) })
                  : TEXT.MINIAPPS_LIVE_LABEL_PROGRESS}
            </p>
          );
        }
        if (node.type === 'stat') {
          const value = numericValue(node.bind, run);
          if (value === undefined || value === null) {
            return null;
          }
          const label = labels[`live.${node.id}`] ?? defaultLabel(node.id) ?? node.bind;
          return (
            <div key={node.id} className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold tabular-nums">{value}</span>
              <span className="text-[11px] opacity-60">{label}</span>
            </div>
          );
        }
        return null;
      })}

      {run.error && (
        <p role="alert" className="truncate text-[11px] text-[var(--as-danger)]">
          {run.error}
        </p>
      )}

      {(cost || onOpenDetails) && (
        <div className="flex items-center gap-2">
          {cost && <span className="min-w-0 flex-1 truncate text-[11px] opacity-60">{cost}</span>}
          {onOpenDetails && (
            <button
              type="button"
              data-no-drag
              className="ml-auto flex w-fit shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--as-primary)] opacity-70 transition-opacity hover:opacity-100"
              onClick={() => onOpenDetails(run.runId, run.packId)}
            >
              <FileText className="h-3 w-3" aria-hidden />
              {TEXT.MINIAPPS_REPORT_OPEN}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
