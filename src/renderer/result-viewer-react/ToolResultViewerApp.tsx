import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Minus, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import type { ToolResultView } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const SCALE_STEP = 1.25;

function readCallId(): string {
  return new URLSearchParams(window.location.search).get('call') ?? '';
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function ToolResultViewerApp(): JSX.Element {
  const callId = useRef(readCallId()).current;
  const [result, setResult] = useState<ToolResultView | null>(null);
  const [missing, setMissing] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, [callId]);

  const images = result?.images ?? [];
  const image = images[imageIndex];

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [imageIndex]);

  const zoomBy = useCallback((factor: number) => {
    setScale((current) => clampScale(current * factor));
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (scale === 1) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.baseX + (event.clientX - drag.startX), y: drag.baseY + (event.clientY - drag.startY) });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const copyText = async (): Promise<void> => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col text-[var(--as-fg)]">
      <div className="rv-drag-region flex h-10 shrink-0 items-center gap-2 border-b border-[var(--as-border)] px-3">
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">{TEXT.TOOL_RESULT_TITLE}</span>
        {result && (
          <>
            <span className="truncate font-mono text-xs opacity-90">{result.tool}</span>
            <Badge variant={result.status === 'error' ? 'danger' : 'outline'} className="text-[10px]">
              {result.status === 'error' ? TEXT.TOOL_RESULT_STATUS_ERROR : TEXT.TOOL_RESULT_STATUS_OK}
            </Badge>
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
            <section aria-label={TEXT.TOOL_RESULT_VIEW_SCREENSHOT} className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center gap-1" data-no-drag>
                <Button variant="ghost" size="sm" title={TEXT.TOOL_RESULT_ZOOM_OUT} onClick={() => zoomBy(1 / SCALE_STEP)}>
                  <ZoomOut className="h-4 w-4" aria-hidden />
                </Button>
                <span className="min-w-12 text-center text-xs tabular-nums opacity-80">{Math.round(scale * 100)}%</span>
                <Button variant="ghost" size="sm" title={TEXT.TOOL_RESULT_ZOOM_IN} onClick={() => zoomBy(SCALE_STEP)}>
                  <ZoomIn className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title={TEXT.TOOL_RESULT_ZOOM_RESET}
                  onClick={() => {
                    setScale(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                </Button>
                {images.length > 1 && (
                  <span className="ml-auto text-xs opacity-70" aria-live="polite">
                    {interpolate(TEXT.TOOL_RESULT_IMAGE_OF, { current: imageIndex + 1, total: images.length })}
                  </span>
                )}
              </div>

              <div
                className={`flex min-h-40 flex-1 items-center justify-center overflow-hidden rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] ${scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onWheel={(event) => zoomBy(event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP)}
              >
                <img
                  src={image}
                  alt={interpolate(TEXT.TOOL_RESULT_IMAGE_OF, { current: imageIndex + 1, total: images.length })}
                  className="max-h-full max-w-full object-contain select-none"
                  draggable={false}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                />
              </div>

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

              {images.length > 1 && (
                <div className="flex items-center justify-center gap-1" data-no-drag>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={TEXT.TOOL_RESULT_PREV_IMAGE}
                    disabled={imageIndex === 0}
                    onClick={() => setImageIndex((index) => Math.max(0, index - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    title={TEXT.TOOL_RESULT_NEXT_IMAGE}
                    disabled={imageIndex === images.length - 1}
                    onClick={() => setImageIndex((index) => Math.min(images.length - 1, index + 1))}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
