import type { JSX } from 'react';
import { Copy, Languages, Search, SquareArrowOutUpRight, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import type { OcrOutcome } from '@shared/ai/ocr';
import { condenseOcrQuery } from '@shared/ai/ocr';
import { TEXT, interpolate } from '@shared/constants/text';
import type { ImageTextAction } from './useImageOcr';

export interface ImageViewerTextPanelProps {
  result: OcrOutcome | null;
  translated: string | null;
  notice: string | null;
  onAction: (action: ImageTextAction, text: string) => void;
  onClose: () => void;
}

/**
 * The extracted-text panel (plan 82, revised): lives under the image in the
 * viewer, for every image — a draft capture, an upload, a transcript image or
 * a stored tool result. One implementation, one place.
 */
export function ImageViewerTextPanel({
  result,
  translated,
  notice,
  onAction,
  onClose,
}: ImageViewerTextPanelProps): JSX.Element | null {
  if (!result) {
    return null;
  }
  const text = result.ok ? result.text : '';
  const engine = result.ok
    ? result.engine === 'local'
      ? TEXT.VIEWER_OCR_ENGINE_LOCAL
      : interpolate(TEXT.VIEWER_OCR_ENGINE_MODEL, { provider: result.provider ?? 'model' })
    : '';
  const failure = result.ok
    ? ''
    : result.reason === 'blocked'
      ? TEXT.VIEWER_OCR_BLOCKED
      : result.reason === 'empty'
        ? TEXT.VIEWER_OCR_EMPTY
        : TEXT.VIEWER_OCR_UNAVAILABLE;

  return (
    <section
      aria-label={TEXT.VIEWER_TEXT_LABEL}
      className="shrink-0 rounded-md border border-[var(--as-border)] bg-[var(--as-muted)]"
      data-testid="viewer-text-panel"
    >
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <h2 className="text-[11px] font-medium uppercase tracking-wide opacity-70">{TEXT.VIEWER_TEXT_LABEL}</h2>
        {engine && <span className="text-[11px] opacity-60">· {engine}</span>}
        {notice && <span className="ml-2 text-[11px] opacity-70" aria-live="polite">{notice}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-1.5"
          title={TEXT.VIEWER_CLOSE_OCR}
          aria-label={TEXT.VIEWER_CLOSE_OCR}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      {result.ok ? (
        <>
          <pre className="max-h-32 overflow-y-auto px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words select-text">
            {text}
          </pre>
          {translated && (
            <p className="max-h-20 overflow-y-auto border-t border-[var(--as-border)] px-2 py-1 text-xs opacity-85" aria-live="polite">
              {translated}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" title={TEXT.VIEWER_COPY_TEXT} onClick={() => onAction('copy', text)}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_COPY_TEXT}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" title={TEXT.VIEWER_INSERT} onClick={() => onAction('insert', text)}>
              <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_INSERT}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={condenseOcrQuery(text) ? TEXT.VIEWER_SEARCH : TEXT.VIEWER_OCR_EMPTY}
              disabled={!condenseOcrQuery(text)}
              onClick={() => onAction('search', text)}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_SEARCH}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" title={TEXT.VIEWER_TRANSLATE} onClick={() => onAction('translate', text)}>
              <Languages className="h-3.5 w-3.5" aria-hidden />
              {TEXT.VIEWER_TRANSLATE}
            </Button>
          </div>
        </>
      ) : (
        <p role="status" className="px-2 pb-2 text-xs opacity-75">
          {failure}
        </p>
      )}
    </section>
  );
}
