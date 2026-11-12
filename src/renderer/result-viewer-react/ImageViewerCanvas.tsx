import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { Check, Crop, Eraser, Minus, RotateCcw, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@neuronection/assistant-ui/button';
import type { CaptureRect } from '@shared/capture';
import {
  effectiveCrop,
  editHint,
  imagePoint,
  imageRectBetween,
  VIEWER_MIN_CROP_PX,
  VIEWER_MIN_REDACT_PX,
  visibleRedacts,
  type ViewerSize,
} from '@shared/viewer';
import { TEXT, interpolate } from '@shared/constants/text';

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const SCALE_STEP = 1.25;
const FALLBACK_SIZE: ViewerSize = { width: 1280, height: 800 };

type EditorMode = 'view' | 'crop' | 'redact';

export interface ImageViewerCanvasProps {
  src: string;
  /** Draft captures may be cropped/redacted; history stays read-only. */
  editable: boolean;
  /** "3 of 5" style caption for multi-image results. */
  badge?: string;
  /** Host image actions (copy image, read text) rendered in the same row. */
  tools?: React.ReactNode;
  onApply?: (dataUrl: string, width: number, height: number) => Promise<boolean>;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function pixelStyle(rect: CaptureRect, natural: ViewerSize): React.CSSProperties {
  return {
    left: `${(rect.x / natural.width) * 100}%`,
    top: `${(rect.y / natural.height) * 100}%`,
    width: `${(rect.width / natural.width) * 100}%`,
    height: `${(rect.height / natural.height) * 100}%`,
  };
}

/**
 * The image surface: zoom/pan for looking, and (plan 81) crop + redact for
 * draft captures. Editing is fit-only on purpose — no zoom while the crop box
 * is being drawn, so screen coordinates map to image pixels unambiguously.
 */
export function ImageViewerCanvas({ src, editable, badge, tools, onApply }: ImageViewerCanvasProps): JSX.Element {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ start: { x: number; y: number } } | null>(null);

  const [mode, setMode] = useState<EditorMode>('view');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<ViewerSize>(FALLBACK_SIZE);
  const [crop, setCrop] = useState<CaptureRect | null>(null);
  const [redacts, setRedacts] = useState<CaptureRect[]>([]);
  const [draft, setDraft] = useState<CaptureRect | null>(null);
  const [busy, setBusy] = useState(false);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    setMode('view');
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setCrop(null);
    setRedacts([]);
    setDraft(null);
  }, [src]);

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setNatural({ width: naturalWidth, height: naturalHeight });
    }
  };

  const editing = mode !== 'view';

  const pointFor = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) {
      return null;
    }
    return imagePoint({ x: clientX, y: clientY }, box, natural);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) {
      const point = pointFor(event.clientX, event.clientY);
      if (!point) {
        return;
      }
      event.preventDefault();
      dragRef.current = { start: point };
      setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    if (scale === 1) {
      return;
    }
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom has no pointer capture; the real window always does.
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (editing) {
      const drag = dragRef.current;
      const point = pointFor(event.clientX, event.clientY);
      if (!drag || !point) {
        return;
      }
      setDraft(imageRectBetween(drag.start, point, natural));
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    setOffset({ x: pan.baseX + (event.clientX - pan.startX), y: pan.baseY + (event.clientY - pan.startY) });
  };

  const onPointerUp = (): void => {
    panRef.current = null;
    const drag = dragRef.current;
    const rect = draft;
    dragRef.current = null;
    if (!drag || !rect) {
      return;
    }
    if (rect.width < VIEWER_MIN_CROP_PX || rect.height < VIEWER_MIN_CROP_PX) {
      setDraft(null);
      return;
    }
    if (mode === 'crop') {
      setCrop(rect);
      setDraft(null);
      return;
    }
    if (mode === 'redact' && rect.width >= VIEWER_MIN_REDACT_PX && rect.height >= VIEWER_MIN_REDACT_PX) {
      setRedacts((current) => [...current, rect]);
    }
    setDraft(null);
  };

  const apply = useCallback(async (): Promise<void> => {
    const image = imageRef.current;
    if (!image || !onApply) {
      return;
    }
    const target = effectiveCrop(crop, natural);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(target.width));
    canvas.height = Math.max(1, Math.round(target.height));
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(image, target.x, target.y, target.width, target.height, 0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    for (const rect of visibleRedacts(redacts, target)) {
      context.fillRect(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height));
    }
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    } catch {
      return;
    }
    if (!dataUrl.startsWith('data:image/')) {
      return;
    }
    setBusy(true);
    const ok = await onApply(dataUrl, canvas.width, canvas.height);
    setBusy(false);
    if (ok) {
      setMode('view');
      setCrop(null);
      setRedacts([]);
    }
  }, [crop, natural, redacts, onApply]);

  useLayoutEffect(() => {
    if (mode === 'view') {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMode('view');
        setDraft(null);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void apply();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [apply, mode]);

  const shownCrop = draft ?? crop;
  const percent = Math.round(scale * 100);

  return (
    <section aria-label={TEXT.TOOL_RESULT_VIEW_SCREENSHOT} className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1" data-no-drag>
        {editing ? (
          <>
            <Button
              variant={mode === 'crop' ? 'default' : 'ghost'}
              size="sm"
              title={TEXT.VIEWER_CROP}
              aria-pressed={mode === 'crop'}
              onClick={() => {
                setMode('crop');
                setDraft(null);
              }}
            >
              <Crop className="h-4 w-4" aria-hidden />
              <span className="sr-only">{TEXT.VIEWER_CROP}</span>
            </Button>
            <Button
              variant={mode === 'redact' ? 'default' : 'ghost'}
              size="sm"
              title={TEXT.VIEWER_REDACT}
              aria-pressed={mode === 'redact'}
              onClick={() => {
                setMode('redact');
                setDraft(null);
              }}
            >
              <Eraser className="h-4 w-4" aria-hidden />
              <span className="sr-only">{TEXT.VIEWER_REDACT}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title={TEXT.VIEWER_UNDO}
              disabled={redacts.length === 0 && crop === null}
              onClick={() => {
                if (redacts.length > 0) {
                  setRedacts((current) => current.slice(0, -1));
                  return;
                }
                setCrop(null);
              }}
            >
              <Undo2 className="h-4 w-4" aria-hidden />
            </Button>
            <span className="ml-1 truncate text-[11px] opacity-70" aria-live="polite">
              {editHint(mode === 'redact' ? 'redact' : 'crop', crop)}
            </span>
            {shownCrop && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums opacity-70">
                {interpolate(TEXT.CAPTURE_SIZE, {
                  width: Math.round(shownCrop.width),
                  height: Math.round(shownCrop.height),
                })}
              </span>
            )}
            <Button variant="ghost" size="sm" title={TEXT.CANCEL_BUTTON} onClick={() => setMode('view')}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="default" size="sm" disabled={busy} title={TEXT.VIEWER_APPLY} onClick={() => void apply()}>
              <Check className="h-4 w-4" aria-hidden />
              {TEXT.VIEWER_APPLY}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" title={TEXT.TOOL_RESULT_ZOOM_OUT} onClick={() => setScale((s) => clampScale(s / SCALE_STEP))}>
              <ZoomOut className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-12 text-center text-xs tabular-nums opacity-80">{percent}%</span>
            <Button variant="ghost" size="sm" title={TEXT.TOOL_RESULT_ZOOM_IN} onClick={() => setScale((s) => clampScale(s * SCALE_STEP))}>
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
            <Minus className="h-3 w-3 opacity-0" aria-hidden />
            {editable && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-1"
                title={TEXT.VIEWER_EDIT}
                onClick={() => setMode('crop')}
              >
                <Crop className="h-4 w-4" aria-hidden />
                {TEXT.VIEWER_EDIT}
              </Button>
            )}
            {tools}
            {badge && <span className="ml-auto text-xs opacity-70">{badge}</span>}
          </>
        )}
      </div>

      <div
        ref={stageRef}
        className={`flex min-h-40 flex-1 items-center justify-center overflow-hidden rounded-md border border-[var(--as-border)] bg-[var(--as-muted)] ${
          editing ? 'cursor-crosshair' : scale > 1 ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        data-testid="viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(event) => {
          if (editing) {
            return;
          }
          setScale((current) => clampScale(event.deltaY < 0 ? current * SCALE_STEP : current / SCALE_STEP));
        }}
      >
        <div
          ref={boxRef}
          className="relative"
          style={editing ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          <img
            ref={imageRef}
            src={src}
            alt={TEXT.VIEWER_IMAGE_TITLE}
            className="block max-h-full max-w-full select-none object-contain"
            draggable={false}
            onLoad={onImageLoad}
          />
          {editing && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {shownCrop && (
                <>
                  <div className="absolute inset-0 bg-black/55" />
                  <div
                    className="absolute border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                    style={{
                      ...pixelStyle(shownCrop, natural),
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    }}
                  />
                </>
              )}
              {redacts.map((rect, index) => (
                <div
                  key={`${rect.x}-${rect.y}-${index}`}
                  className="absolute bg-black"
                  style={pixelStyle(rect, natural)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
