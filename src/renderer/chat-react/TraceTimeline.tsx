import { useEffect, useState, type JSX } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { ChatTraceMeta } from '@neuronection/assistant-ui/chat-trace-meta';
import { ChatTraceTimeline, type ChatTraceTimelineEntry } from '@neuronection/assistant-ui/chat-trace-timeline';
import { TurnMetadata, TurnTraceStep } from '@shared/turns';
import { TEXT, pluralize } from '@shared/constants/text';

export interface TraceTimelineProps {
  meta: TurnMetadata | undefined;
  /** Live turns: when set, the elapsed time ticks instead of using `meta.durationMs`. */
  startedAt?: number | null;
  className?: string;
}

function useTickedNow(startedAt: number | null | undefined): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt == null) {
      setNow(null);
      return undefined;
    }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt != null ? now : null;
}

function prettyPayload(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function humanizeDecisionPayload(detail: Record<string, unknown>): string {
  const known = ['engine', 'confidence', 'band', 'reason', 'reasoning'];
  const lines: string[] = [];
  if (typeof detail.engine === 'string') {
    lines.push(`${TEXT.TRACE_PAYLOAD_ENGINE}: ${detail.engine}`);
  }
  if (typeof detail.confidence === 'number') {
    lines.push(`${TEXT.TRACE_PAYLOAD_CONFIDENCE}: ${Math.round(detail.confidence * 100)}%`);
  }
  if (typeof detail.band === 'string') {
    lines.push(`${TEXT.TRACE_PAYLOAD_BAND}: ${detail.band}`);
  }
  if (typeof detail.reason === 'string') {
    lines.push(`${TEXT.TRACE_PAYLOAD_REASON}: ${detail.reason}`);
  }
  if (typeof detail.reasoning === 'string') {
    lines.push(`${TEXT.TRACE_PAYLOAD_REASONING}: ${detail.reasoning}`);
  }
  for (const key of Object.keys(detail)) {
    if (!known.includes(key)) {
      lines.push(`${key}: ${compactValue(detail[key])}`);
    }
  }
  return lines.join('\n');
}

function humanizeSelectionDecisions(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return String(entry);
      }
      const record = entry as { appName?: unknown; reason?: unknown; toolNames?: unknown[] };
      const name = typeof record.appName === 'string' ? record.appName : 'unknown';
      const reason = typeof record.reason === 'string' ? record.reason : '';
      const tools = Array.isArray(record.toolNames) ? record.toolNames.filter((tool) => typeof tool === 'string') : [];
      const header = `${name} — ${reason}${tools.length > 0 ? ` · ${tools.length} ${pluralize(tools.length, TEXT.TRACE_PAYLOAD_TOOL_ONE, TEXT.TRACE_PAYLOAD_TOOL_MANY)}` : ''}`;
      return tools.length > 0 ? `${header}\n  ${tools.join(', ')}` : header;
    })
    .join('\n');
}

/** Known payload shapes render human-readable; the rest stay pretty JSON. */
function humanizePayload(step: TurnTraceStep): string | null {
  if (step.detail == null) {
    return null;
  }
  if (step.id.startsWith('app_selection_')) {
    const humanized = humanizeSelectionDecisions(step.detail);
    if (humanized !== null) {
      return humanized;
    }
  }
  if (step.id.startsWith('decision_') && typeof step.detail === 'object') {
    return humanizeDecisionPayload(step.detail as Record<string, unknown>);
  }
  return prettyPayload(step.detail);
}

export function isDecisionTraceStep(step: TurnTraceStep): boolean {
  return step.id.startsWith('decision_');
}

export interface TraceMetaRowProps {
  meta: TurnMetadata | undefined;
  className?: string;
}

/**
 * The one completed-turn trace surface across every view (plan 20 S6
 * simplification): the collapsed library badge row — model · duration ·
 * tools. Renders nothing without metadata; the step timeline stays a
 * live-streaming affordance behind `behavior.traceDetails`.
 */
export function TraceMetaRow({ meta, className }: TraceMetaRowProps): JSX.Element | null {
  const toolCount = meta?.toolCount ?? (meta?.steps ?? []).filter((step) => step.phase === 'tool_call').length;
  return (
    <ChatTraceMeta
      className={className}
      model={meta?.model}
      durationMs={meta?.durationMs}
      toolCount={toolCount > 0 ? toolCount : undefined}
    />
  );
}

export function traceTimelineEntries(steps: TurnTraceStep[] | undefined): ChatTraceTimelineEntry[] {
  return (steps ?? []).map((step) => {
    if (step.phase === 'tool_call') {
      return {
        kind: 'tool' as const,
        label: step.toolName ?? step.label,
        detail: step.summary ?? null,
        args: prettyPayload(step.detail),
        startMs: step.startedAt,
        durationMs: step.endedAt != null ? step.endedAt - step.startedAt : null,
      };
    }
    if (step.phase === 'tool_result') {
      return {
        kind: 'tool' as const,
        label: TEXT.TRACE_PHASE_TOOL_RESULT,
        detail: step.summary ?? null,
        response: step.response ?? step.summary ?? null,
        status: step.status ?? (step.summary?.startsWith('Failed:') ? 'error' : 'ok'),
        startMs: step.startedAt,
        durationMs: step.endedAt != null ? step.endedAt - step.startedAt : null,
      };
    }
    return {
      kind: 'phase' as const,
      label: step.label || TEXT.TRACE_PHASE_THINKING,
      detail: step.summary ?? null,
      args: humanizePayload(step),
      response: step.response ?? null,
      startMs: step.startedAt,
      durationMs: step.endedAt != null ? step.endedAt - step.startedAt : null,
    };
  });
}

export function TraceTimeline(props: TraceTimelineProps): JSX.Element | null {
  const entries = traceTimelineEntries(props.meta?.steps);
  const tick = useTickedNow(props.startedAt);
  const elapsedMs = props.startedAt != null && tick != null ? tick - props.startedAt : props.meta?.durationMs;
  const imageSteps = (props.meta?.steps ?? []).filter((step) => step.hasImages);

  const openResult = (callId: string): void => {
    void window.electronAPI.openToolResultViewer(callId);
  };

  if (entries.length === 0 && elapsedMs == null) {
    return null;
  }

  // Turns without tool calls show the compact badge — there is nothing
  // to graph — unless a decision engine ran: its step is the story.
  const toolCount = entries.filter((entry) => entry.kind === 'tool').length;
  const hasDecision = (props.meta?.steps ?? []).some(isDecisionTraceStep);
  if (toolCount === 0 && !hasDecision) {
    return (
      <ChatTraceMeta
        className={props.className}
        model={props.meta?.model}
        durationMs={elapsedMs ?? undefined}
      />
    );
  }

  return (
    <div className={props.className}>
      <ChatTraceTimeline
        trace={{ model: props.meta?.model ?? null, latencyMs: elapsedMs ?? null }}
        entries={entries}
        labels={{
          toggle: TEXT.TRACE_TIMELINE_TOGGLE,
          tools: TEXT.TRACE_TIMELINE_TOOLS,
          total: TEXT.TRACE_TIMELINE_TOTAL,
          tokens: TEXT.TRACE_TIMELINE_TOKENS,
          reasoning: TEXT.TRACE_TIMELINE_REASONING,
        }}
      />
      {imageSteps.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 px-1" data-no-drag>
          {imageSteps.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => openResult(step.id)}
              className="flex items-center gap-1 rounded-md border border-[var(--as-border)] px-1.5 py-0.5 text-[10px] text-[var(--as-muted-fg)] transition-colors hover:bg-[var(--as-muted)]"
            >
              <ImageIcon className="h-3 w-3" aria-hidden />
              {TEXT.TOOL_RESULT_VIEW_SCREENSHOT}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
