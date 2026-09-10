import { useEffect, useState, type JSX } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { ChatTraceMeta } from '@neuronection/assistant-ui/chat-trace-meta';
import { ChatTraceTimeline, type ChatTraceTimelineEntry } from '@neuronection/assistant-ui/chat-trace-timeline';
import { TurnMetadata, TurnTraceStep } from '@shared/turns';
import { TEXT } from '@shared/constants/text';

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
      label: TEXT.TRACE_PHASE_THINKING,
      detail: step.summary ?? null,
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

  // Turns without tool calls show the compact badge — there is nothing to graph.
  const toolCount = entries.filter((entry) => entry.kind === 'tool').length;
  if (toolCount === 0) {
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
