import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { Download, GitCompare, Play, RotateCcw, Square } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunDiffView, MiniAppRunEventPayload, MiniAppRunView } from '@shared/app-pack';

const STATUS_KEY: Record<string, string> = {
  queued: TEXT.MINIAPPS_RUN_STATUS_QUEUED,
  running: TEXT.MINIAPPS_RUN_STATUS_RUNNING,
  paused: TEXT.MINIAPPS_RUN_STATUS_PAUSED,
  done: TEXT.MINIAPPS_RUN_STATUS_DONE,
  failed: TEXT.MINIAPPS_RUN_STATUS_FAILED,
  canceled: TEXT.MINIAPPS_RUN_STATUS_CANCELED,
  interrupted: TEXT.MINIAPPS_RUN_STATUS_INTERRUPTED,
};

export function runStatusLabel(status: string): string {
  return STATUS_KEY[status] ?? status;
}

function costLine(run: MiniAppRunView): string {
  const parts: string[] = [];
  if (run.estimateCalls > 0) {
    parts.push(interpolate(TEXT.MINIAPPS_RUN_ESTIMATE, { count: String(run.estimateCalls) }));
  }
  if (run.actualCalls > 0) {
    parts.push(interpolate(TEXT.MINIAPPS_RUN_CALLS, { count: String(run.actualCalls) }));
  }
  if (run.inputTokens > 0 || run.outputTokens > 0) {
    parts.push(interpolate(TEXT.MINIAPPS_RUN_TOKENS, { in: String(run.inputTokens), out: String(run.outputTokens) }));
  }
  return parts.join(' · ');
}

function DiffModal({ diff, onClose }: { diff: MiniAppRunDiffView; onClose: () => void }): ReactElement {
  const kindLabel: Record<string, string> = {
    new: TEXT.MINIAPPS_RUN_DIFF_NEW,
    removed: TEXT.MINIAPPS_RUN_DIFF_REMOVED,
    changed: TEXT.MINIAPPS_RUN_DIFF_CHANGED,
    'verdict-change': TEXT.MINIAPPS_RUN_DIFF_CHANGED,
  };
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{TEXT.MINIAPPS_RUN_DIFF}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {diff.baselineRunId === null ? (
            <p className="text-sm text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUN_DIFF_EMPTY}</p>
          ) : diff.entries.length === 0 ? (
            <p className="text-sm text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUN_DIFF_NONE}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {diff.entries.map((entry) => (
                <li key={`${entry.kind}:${entry.relPath}`} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {kindLabel[entry.kind]}
                  </Badge>
                  <span className="truncate">{entry.relPath}</span>
                  {entry.kind === 'verdict-change' && (
                    <span className="text-xs text-[var(--as-muted-foreground)]">
                      {interpolate(TEXT.MINIAPPS_RUN_DIFF_VERDICT, { before: entry.before ?? '?', after: entry.after ?? '?' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {TEXT.CLOSE_BUTTON}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * The per-pack runs area (plan 26 S4): start/cancel/resume, live status
 * driven by the `miniapps:run-event` push (renderer renders, never
 * orchestrates), run history with cost + exports and the
 * changed-since-last-run diff.
 */
export function PackRuns({ packId }: { packId: string }): ReactElement | null {
  const [runs, setRuns] = useState<MiniAppRunView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{ estimateCalls?: number; done?: number; total?: number }>({});
  const [diff, setDiff] = useState<MiniAppRunDiffView | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const rows = await window.electronAPI.listMiniAppRuns(packId);
    if (mounted.current) {
      setRuns(rows);
    }
  }, [packId]);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.electronAPI.onMiniAppRunEvent((event) => {
      if (event.packId !== packId) {
        return;
      }
      if (event.type === 'run:progress' && event.estimateCalls !== undefined) {
        setLive((current) => ({ ...current, estimateCalls: event.estimateCalls }));
      }
      if (event.type === 'run:progress' && event.done !== undefined && event.total !== undefined && event.phase === 'decide') {
        setLive((current) => ({ ...current, done: event.done, total: event.total }));
      }
      if (event.type.startsWith('run:') && ['run:finished', 'run:failed', 'run:canceled', 'run:paused', 'run:resumed'].includes(event.type)) {
        void refresh();
      }
    });
    return unsubscribe;
  }, [packId, refresh]);

  const start = useCallback(async () => {
    setError(null);
    setLive({});
    const picked = await window.electronAPI.pickMiniAppRoot();
    if (!picked.ok) {
      if (picked.error === 'cancelled') {
        return;
      }
      setError(interpolate(TEXT.MINIAPPS_RUN_START_FAILED, { error: picked.error }));
      return;
    }
    const started = await window.electronAPI.startMiniAppRun(packId, picked.root);
    if (!started.ok) {
      setError(interpolate(TEXT.MINIAPPS_RUN_START_FAILED, { error: started.error }));
      return;
    }
    await refresh();
  }, [packId, refresh]);

  const active = useMemo(() => runs.find((run) => run.status === 'running'), [runs]);
  const resumable = useMemo(() => runs.find((run) => run.status === 'paused' || run.status === 'interrupted'), [runs]);

  const cancel = useCallback(async (runId: string) => {
    await window.electronAPI.cancelMiniAppRun(runId);
    await refresh();
  }, [refresh]);

  const resume = useCallback(async (runId: string) => {
    setError(null);
    const result = await window.electronAPI.resumeMiniAppRun(runId);
    if (!result.ok) {
      setError(interpolate(TEXT.MINIAPPS_RUN_START_FAILED, { error: result.error }));
    }
    await refresh();
  }, [refresh]);

  const exportAs = useCallback(async (runId: string, format: 'markdown' | 'json' | 'csv') => {
    const exported = await window.electronAPI.exportMiniAppRun(runId, format);
    if (exported.ok) {
      await window.electronAPI.saveFile({ defaultPath: exported.fileName, content: exported.text });
    }
  }, []);

  const openDiff = useCallback(async (runId: string) => {
    const view = await window.electronAPI.diffMiniAppRun(runId);
    if (view) {
      setDiff(view);
    }
  }, []);

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--as-border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-medium text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUNS_TITLE}</h4>
        <Button size="sm" variant="outline" onClick={() => void start()}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_RUN_START}
        </Button>
        {active && (
          <Button size="sm" variant="outline" onClick={() => void cancel(active.id)}>
            <Square className="h-3.5 w-3.5" aria-hidden />
            {TEXT.MINIAPPS_RUN_CANCEL}
          </Button>
        )}
        {resumable && (
          <Button size="sm" variant="outline" onClick={() => void resume(resumable.id)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {TEXT.MINIAPPS_RUN_RESUME}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-[var(--as-destructive)]">
            {error}
          </p>
        )}
      </div>
      {active && live.estimateCalls !== undefined && (
        <p className="text-xs text-[var(--as-muted-foreground)]" aria-live="polite">
          {interpolate(TEXT.MINIAPPS_RUN_ESTIMATE, { count: String(live.estimateCalls) })}
          {live.total !== undefined && live.done !== undefined
            ? ` — ${interpolate(TEXT.MINIAPPS_RUN_PROGRESS, { done: String(live.done), total: String(live.total) })}`
            : ''}
        </p>
      )}
      {runs.length === 0 ? (
        <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.MINIAPPS_RUNS_EMPTY}</p>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--as-border)] px-2.5 py-1.5 text-xs">
              <Badge variant={run.status === 'done' ? 'secondary' : 'outline'} className="text-[10px]">
                {runStatusLabel(run.status)}
              </Badge>
              <span className="truncate">{run.rootPath.split('/').pop() ?? run.rootPath}</span>
              <span className="text-[var(--as-muted-foreground)]">{costLine(run)}</span>
              {run.totals && run.totals.pending > 0 && (
                <span className="text-[var(--as-muted-foreground)]">
                  {interpolate(TEXT.MINIAPPS_RUN_PENDING, { count: String(run.totals.pending) })}
                </span>
              )}
              {run.error && <span className="truncate text-[var(--as-destructive)]">{run.error}</span>}
              <span className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => void openDiff(run.id)} aria-label={TEXT.MINIAPPS_RUN_DIFF}>
                  <GitCompare className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void exportAs(run.id, 'markdown')} aria-label={TEXT.MINIAPPS_RUN_EXPORT_MD}>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {diff && <DiffModal diff={diff} onClose={() => setDiff(null)} />}
    </div>
  );
}
