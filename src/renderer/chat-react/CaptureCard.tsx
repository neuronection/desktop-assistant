import { useCallback, useEffect, useState, type JSX } from 'react';
import { Check, Copy, Crop, ImageDown, Languages, ScanText, Search, SquareArrowOutUpRight, X } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import type { CaptureAttachmentMeta } from '@shared/capture';
import type { OcrOutcome } from '@shared/ai/ocr';
import { condenseOcrQuery } from '@shared/ai/ocr';
import { TEXT, interpolate } from '@shared/constants/text';

export interface CaptureCardState {
  /** Attachment slot the capture landed in (for Edit). */
  index: number;
  dataUrl: string;
  meta: CaptureAttachmentMeta;
}

export type CaptureTextActionId = 'copy' | 'insert' | 'search' | 'translate';

export interface CaptureCardProps {
  card: CaptureCardState;
  ocr: OcrOutcome | null;
  busy: boolean;
  translated: string | null;
  onOcr: () => void;
  onCopyImage: () => void;
  onTextAction: (action: CaptureTextActionId, text: string) => void;
  onEdit: () => void;
  onDismiss: () => void;
}

/**
 * The capture result card (plan 82): what was grabbed, one action row, and the
 * OCR text once it exists. Host-owned — a mini-app pack cannot carry an image
 * payload, and this surface must behave identically in every window.
 */
export function CaptureCard({
  card,
  ocr,
  busy,
  translated,
  onOcr,
  onCopyImage,
  onTextAction,
  onEdit,
  onDismiss,
}: CaptureCardProps): JSX.Element {
  const [copied, setCopied] = useState<'image' | 'text' | null>(null);
  const text = ocr?.ok ? ocr.text ?? '' : '';
  const engineLabel = ocr?.ok
    ? ocr.engine === 'local'
      ? TEXT.CAPTURE_CARD_ENGINE_LOCAL
      : interpolate(TEXT.CAPTURE_CARD_ENGINE_MODEL, { provider: ocr.provider ?? 'model' })
    : '';

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyText = useCallback(() => {
    if (!text) {
      return;
    }
    onTextAction('copy', text);
    setCopied('text');
  }, [onTextAction, text]);

  return (
    <section
      aria-label={TEXT.CAPTURE_CARD_LABEL}
      className="mb-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-2"
      data-testid="capture-card"
    >
      <div className="flex gap-2">
        <img
          src={card.dataUrl}
          alt={card.meta.label}
          className="h-16 w-24 shrink-0 rounded-md border border-[var(--as-border)] object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{card.meta.label}</p>
          <p className="text-[11px] tabular-nums opacity-60">
            {interpolate(TEXT.CAPTURE_SIZE, { width: card.meta.width, height: card.meta.height })}
            {engineLabel ? ` · ${engineLabel}` : ''}
          </p>
          {text && (
            <pre
              className="mt-1 max-h-20 overflow-y-auto rounded border border-[var(--as-border)] bg-[var(--as-muted)] p-1.5 font-mono text-[11px] whitespace-pre-wrap break-words"
              aria-live="polite"
            >
              {text}
            </pre>
          )}
          {ocr && !ocr.ok && (
            <p role="status" className="mt-1 text-[11px] text-[var(--as-warning,#c9a227)]">
              {ocr.message ??
                (ocr.reason === 'blocked'
                  ? TEXT.CAPTURE_CARD_OCR_BLOCKED
                  : ocr.reason === 'empty'
                    ? TEXT.CAPTURE_CARD_OCR_EMPTY
                    : TEXT.CAPTURE_CARD_OCR_UNAVAILABLE)}
            </p>
          )}
          {translated && text && (
            <p className="mt-1 max-h-16 overflow-y-auto text-[11px] opacity-80" aria-live="polite">
              {translated}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={TEXT.CLOSE_BUTTON}
          aria-label={TEXT.CAPTURE_CARD_DISMISS}
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          title={TEXT.CAPTURE_CARD_COPY_IMAGE}
          onClick={() => {
            onCopyImage();
            setCopied('image');
          }}
        >
          {copied === 'image' ? <Check className="h-3.5 w-3.5" aria-hidden /> : <ImageDown className="h-3.5 w-3.5" aria-hidden />}
          {TEXT.CAPTURE_CARD_COPY_IMAGE}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          title={TEXT.CAPTURE_CARD_OCR}
          aria-busy={busy}
          disabled={busy}
          onClick={onOcr}
        >
          <ScanText className="h-3.5 w-3.5" aria-hidden />
          {TEXT.CAPTURE_CARD_OCR}
        </Button>
        {text && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.CAPTURE_CARD_COPY_TEXT}
              onClick={copyText}
            >
              {copied === 'text' ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {TEXT.CAPTURE_CARD_COPY_TEXT}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.CAPTURE_CARD_INSERT}
              onClick={() => onTextAction('insert', text)}
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden />
              {TEXT.CAPTURE_CARD_INSERT}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={condenseOcrQuery(text) ? TEXT.CAPTURE_CARD_SEARCH : TEXT.CAPTURE_CARD_OCR_EMPTY}
              disabled={!condenseOcrQuery(text)}
              onClick={() => onTextAction('search', text)}
            >
              <Search className="h-3.5 w-3.5" aria-hidden />
              {TEXT.CAPTURE_CARD_SEARCH}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              title={TEXT.CAPTURE_CARD_TRANSLATE}
              onClick={() => onTextAction('translate', text)}
            >
              <Languages className="h-3.5 w-3.5" aria-hidden />
              {TEXT.CAPTURE_CARD_TRANSLATE}
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-[11px]"
          title={TEXT.VIEWER_EDIT}
          onClick={onEdit}
        >
          <Crop className="h-3.5 w-3.5" aria-hidden />
          {TEXT.VIEWER_EDIT}
        </Button>
      </div>
    </section>
  );
}
