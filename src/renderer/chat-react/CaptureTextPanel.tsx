import type { JSX } from 'react';
import { Copy, Languages, Search, SquareArrowOutUpRight, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import { condenseOcrQuery } from '@shared/ai/ocr';
import { TEXT, interpolate } from '@shared/constants/text';

export interface CaptureTextState {
  /** What was read (a capture label or an attachment name). */
  label: string;
  text: string;
  engine: 'local' | 'model' | null;
  provider?: string;
  translated: string | null;
  /** Why there is no text (no engine, blocked, empty, failed). */
  failure: string | null;
  notice: string | null;
}

export interface CaptureTextPanelProps {
  state: CaptureTextState;
  busy: boolean;
  onAction: (action: 'copy' | 'insert' | 'search' | 'translate', text: string) => void;
  onClose: () => void;
}

/**
 * Extracted text, in the app (plan 82 revision): reading text must not open a
 * second window. Same actions as the viewer's panel — copy / insert / search /
 * translate — on one compact, scrollable block above the composer.
 */
export function CaptureTextPanel({ state, busy, onAction, onClose }: CaptureTextPanelProps): JSX.Element {
  const reading = busy && !state.text && !state.failure;
  const engine = state.engine
    ? state.engine === 'local'
      ? TEXT.VIEWER_OCR_ENGINE_LOCAL
      : interpolate(TEXT.VIEWER_OCR_ENGINE_MODEL, { provider: state.provider ?? 'model' })
    : '';
  const searchable = condenseOcrQuery(state.text).length > 0;

  return (
    <section
      aria-label={TEXT.VIEWER_TEXT_LABEL}
      aria-busy={busy}
      // The launcher root is a window-drag region; anything that scrolls or
      // selects must opt out or the OS eats the wheel and the pointer.
      data-no-drag
      className="mb-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-2"
      data-testid="capture-text-panel"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide opacity-70">{TEXT.VIEWER_TEXT_LABEL}</h2>
        <span className="min-w-0 truncate text-[11px] opacity-60" title={state.label}>
          {state.label}
        </span>
        {engine && <span className="shrink-0 text-[11px] opacity-60">· {engine}</span>}
        {state.notice && (
          <span className="ml-auto shrink-0 text-[11px] opacity-70" aria-live="polite">
            {state.notice}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6 shrink-0"
          title={TEXT.VIEWER_CLOSE_OCR}
          aria-label={TEXT.VIEWER_CLOSE_OCR}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {reading ? (
        <p role="status" aria-live="polite" className="mt-1 flex items-center gap-2 text-xs opacity-75">
          <span
            aria-hidden="true"
            className="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent"
          />
          {TEXT.VIEWER_OCR_RUNNING}
        </p>
      ) : state.failure ? (
        <p role="status" className="mt-1 text-xs opacity-75">
          {state.failure}
        </p>
      ) : (
        <>
          <pre
            tabIndex={0}
            className="mt-1 max-h-28 overflow-y-auto overscroll-contain rounded border border-[var(--as-border)] bg-[var(--as-muted)] p-1.5 font-mono text-xs whitespace-pre-wrap break-words select-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--as-primary)]"
          >
            {state.text}
          </pre>
          {state.translated && (
            <p className="mt-1 max-h-20 overflow-y-auto text-xs opacity-85" aria-live="polite">
              {state.translated}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.VIEWER_COPY_TEXT}
              onClick={() => onAction('copy', state.text)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_COPY_TEXT}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.VIEWER_INSERT}
              onClick={() => onAction('insert', state.text)}
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_INSERT}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={searchable ? TEXT.VIEWER_SEARCH : TEXT.VIEWER_OCR_EMPTY}
              disabled={!searchable}
              onClick={() => onAction('search', state.text)}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_SEARCH}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.VIEWER_TRANSLATE}
              onClick={() => onAction('translate', state.text)}
            >
              <Languages className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_TRANSLATE}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
