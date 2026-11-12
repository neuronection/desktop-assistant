import { useEffect, useRef, useState, type JSX } from 'react';
import { Check, Copy, ImageDown, Minus, ScanText, X } from 'lucide-react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import type { ToolResultView } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';
import { ImageViewerCanvas } from './ImageViewerCanvas';
import { ImageViewerTextPanel } from './ImageViewerTextPanel';
import { useImageOcr } from './useImageOcr';

function readQueryParam(name: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

export function ToolResultViewerApp(): JSX.Element {
  const callId = useRef(readQueryParam('call')).current;
  const imageToken = useRef(readQueryParam('image')).current;
  const imageMode = imageToken.length > 0;
  const [result, setResult] = useState<ToolResultView | null>(null);
  const [missing, setMissing] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (imageMode) {
      void window.electronAPI
        .getViewerImage(imageToken)
        .then((view) => {
          if (cancelled) return;
          if (view) {
            setResult({ callId: view.token, tool: view.title, status: 'ok', text: '', images: [view.dataUrl] });
          } else {
            setMissing(true);
          }
        })
        .catch(() => setMissing(true));
      return () => {
        cancelled = true;
      };
    }
    void window.electronAPI
      .getToolResult(callId)
      .then((view) => {
        if (cancelled) return;
        if (view) {
          setResult(view);
        } else {
          setMissing(true);
        }
      })
      .catch(() => setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [callId, imageMode, imageToken]);

  const images = result?.images ?? [];
  const image = images[imageIndex];
  const ocr = useImageOcr(image ?? null, {
    copied: TEXT.VIEWER_COPIED,
    inserted: TEXT.VIEWER_INSERTED,
    search: TEXT.VIEWER_SEARCH_READY,
  });

  const copyText = async (): Promise<void> => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col text-[var(--as-fg)]">
      <div className="rv-drag-region flex h-10 shrink-0 items-center gap-2 border-b border-[var(--as-border)] px-3">
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">
          {imageMode ? TEXT.VIEWER_IMAGE_TITLE : TEXT.TOOL_RESULT_TITLE}
        </span>
        {result && (
          <>
            <span className="truncate text-xs opacity-90">{result.tool}</span>
            {!imageMode && (
              <Badge variant={result.status === 'error' ? 'danger' : 'outline'} className="text-[10px]">
                {result.status === 'error' ? TEXT.TOOL_RESULT_STATUS_ERROR : TEXT.TOOL_RESULT_STATUS_OK}
              </Badge>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1" data-no-drag>
          <Button variant="ghost" size="sm" title={TEXT.DESKTOP_MINIMIZE} onClick={() => void window.electronAPI.minimizeWindow()}>
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" title={TEXT.CLOSE_BUTTON} onClick={() => void window.electronAPI.closeWindow()}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {missing && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm opacity-70" role="status">
          {TEXT.TOOL_RESULT_MISSING}
        </div>
      )}

      {!missing && !result && (
        <div className="flex flex-1 items-center justify-center p-6 text-sm opacity-70" role="status">
          …
        </div>
      )}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {result.text && (
            <section aria-label={TEXT.TOOL_RESULT_TITLE} className="shrink-0">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wide opacity-70">{TEXT.TRACE_TIMELINE_RESPONSE}</h2>
                <Button variant="ghost" size="sm" title={TEXT.TOOL_RESULT_COPY} onClick={() => void copyText()}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? TEXT.TOOL_RESULT_COPIED : TEXT.TOOL_RESULT_COPY}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] p-2 font-mono text-xs whitespace-pre-wrap break-words select-text">
                {result.text}
              </div>
            </section>
          )}

          {image && (
            <ImageViewerCanvas
              src={image}
              tools={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    title={TEXT.VIEWER_COPY_IMAGE}
                    onClick={() => void ocr.copyImage()}
                  >
                    <ImageDown className="h-4 w-4" aria-hidden />
                    {TEXT.VIEWER_COPY_IMAGE}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    title={TEXT.VIEWER_OCR}
                    aria-busy={ocr.busy}
                    disabled={ocr.busy}
                    onClick={() => void ocr.read()}
                  >
                    <ScanText className="h-4 w-4" aria-hidden />
                    {TEXT.VIEWER_OCR}
                  </Button>
                </>
              }
              editable={imageMode && result?.callId === imageToken}
              badge={
                images.length > 1
                  ? interpolate(TEXT.TOOL_RESULT_IMAGE_OF, { current: imageIndex + 1, total: images.length })
                  : undefined
              }
              onApply={
                imageMode && result?.callId === imageToken
                  ? async (dataUrl, width, height) => window.electronAPI.applyViewerEdit(imageToken, { dataUrl, width, height })
                  : undefined
              }
            />
          )}

          {image && (
            <ImageViewerTextPanel
              result={ocr.result}
              translated={ocr.translated}
              notice={ocr.notice}
              onAction={(action, text) => void ocr.act(action, text)}
              onClose={ocr.reset}
            />
          )}

          {images.length > 1 && (
            <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" data-no-drag>
              {images.map((thumb, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={interpolate(TEXT.TOOL_RESULT_IMAGE_OF, { current: index + 1, total: images.length })}
                  aria-current={index === imageIndex}
                  onClick={() => setImageIndex(index)}
                  className={`h-14 w-20 shrink-0 overflow-hidden rounded border transition-colors ${
                    index === imageIndex ? 'border-[var(--as-primary)]' : 'border-[var(--as-border)] opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
