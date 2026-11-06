import type { JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { FileText, PanelRight, Play, Square } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { MiniAppRunExecutionView } from '@shared/app-pack';

export interface RunSummaryInput {
  status: string;
  startedAt?: number;
  finishedAt?: number | null;
  engineId?: string;
  execution?: MiniAppRunExecutionView | null;
  actualCalls?: number;
  estimateCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return interpolate(TEXT.MINIAPPS_RUN_DURATION_S, { seconds: String(seconds) });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return interpolate(TEXT.MINIAPPS_RUN_DURATION_MS, { minutes: String(minutes), seconds: String(seconds % 60) });
  }
  return interpolate(TEXT.MINIAPPS_RUN_DURATION_HM, { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) });
}

export function formatRunClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function engineLabel(engineId: string | undefined): string | null {
  if (engineId === undefined || engineId.length === 0 || engineId === 'none') {
    return null;
  }
  const [kind, providerId, model] = engineId.split(':');
  return model !== undefined ? `${kind}:${model}` || kind : kind || providerId;
}

/**
 * The run's execution facts (plan 54) — one summary line shared by the
 * chat run card and the report header: decision engine + the resolved
 * provider/model pairs, elapsed time and the finish clock, plus the
 * call/token tallies. Facts render only when present — never a guess.
 */
export function RunSummary({ run, compact = false }: { run: RunSummaryInput; compact?: boolean }): JSX.Element | null {
  const decision = run.execution?.decision;
  const llm = run.execution?.llm;
  const engine = engineLabel(run.engineId);
  const startedAt = run.startedAt;
  const finishedAt = run.finishedAt ?? null;
  const elapsed = startedAt !== undefined ? (finishedAt ?? Date.now()) - startedAt : null;
  const fact = (label: string, value: string): JSX.Element => (
    <span key={label} className="inline-flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wide opacity-60">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
  const facts: JSX.Element[] = [];
  if (engine !== null) {
    facts.push(fact(TEXT.MINIAPPS_RUN_DECISION, engine));
  }
  if (decision) {
    facts.push(fact(TEXT.MINIAPPS_RUN_DECISION, `${decision.providerName} · ${decision.model}`));
  }
  if (llm) {
    facts.push(fact(TEXT.MINIAPPS_RUN_LLM, `${llm.providerName} · ${llm.model}`));
  }
  if (elapsed !== null) {
    facts.push(<span key="elapsed">{interpolate(TEXT.MINIAPPS_RUN_ELAPSED, { duration: formatRunDuration(elapsed) })}</span>);
  }
  if (finishedAt !== null) {
    facts.push(<span key="finished">{interpolate(TEXT.MINIAPPS_RUN_FINISHED_AT, { time: formatRunClock(finishedAt) })}</span>);
  }
  if ((run.actualCalls ?? 0) > 0 || (run.estimateCalls ?? 0) > 0) {
    facts.push(<span key="calls">{interpolate(TEXT.MINIAPPS_RUN_CALLS, { count: String(run.actualCalls ?? run.estimateCalls ?? 0) })}</span>);
  }
  if ((run.inputTokens ?? 0) > 0 || (run.outputTokens ?? 0) > 0) {
    facts.push(<span key="tokens">{interpolate(TEXT.MINIAPPS_RUN_TOKENS, { in: String(run.inputTokens ?? 0), out: String(run.outputTokens ?? 0) })}</span>);
  }
  if (facts.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="run-summary"
      className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--as-muted-foreground)] ${compact ? 'opacity-90' : ''}`}
    >
      {facts}
    </div>
  );
}

export interface RunActionsProps {
  status: string;
  onStop?: () => void;
  onRestart?: () => void;
  onViewReport?: () => void;
  onExport?: () => void;
  onOpenWindow?: () => void;
  /** Extra actions (diff, …) supplied by the host surface. */
  extra?: JSX.Element | null;
}

/**
 * The uniform run action row (plan 54): Stop while running, Restart on a
 * settled run, View report always available; hosts add their own tail.
 */
export function RunActions({ status, onStop, onRestart, onViewReport, onExport, onOpenWindow, extra }: RunActionsProps): JSX.Element | null {
  const running = status === 'running' || status === 'queued';
  const any = (running && onStop) || (!running && onRestart) || onViewReport || onExport || onOpenWindow || extra;
  if (!any) {
    return null;
  }
  return (
    <div data-testid="run-actions" className="flex flex-wrap items-center gap-1.5">
      {running && onStop && (
        <Button size="sm" variant="outline" data-testid="run-action-stop" onClick={onStop}>
          <Square className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_RUN_STOP}
        </Button>
      )}
      {!running && onRestart && (
        <Button size="sm" variant="outline" data-testid="run-action-restart" onClick={onRestart}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_RUN_RESTART}
        </Button>
      )}
      {onViewReport && (
        <Button size="sm" variant="ghost" data-testid="run-action-report" onClick={onViewReport}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_REPORT_OPEN}
        </Button>
      )}
      {onExport && (
        <Button size="sm" variant="ghost" data-testid="run-action-export" onClick={onExport}>
          {TEXT.MINIAPPS_RUN_EXPORT_MD}
        </Button>
      )}
      {onOpenWindow && (
        <Button size="sm" variant="ghost" data-testid="run-action-window" onClick={onOpenWindow}>
          <PanelRight className="h-3.5 w-3.5" aria-hidden />
          {TEXT.MINIAPPS_WINDOW_OPEN}
        </Button>
      )}
      {extra}
    </div>
  );
}
