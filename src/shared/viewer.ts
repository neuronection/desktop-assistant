import { normalizeRect, type CaptureRect } from './capture';

/**
 * The image viewer's edit vocabulary (plan 81). Geometry is pure so the crop
 * and redact rects can be reasoned about (and tested) without a canvas; the
 * compositing itself happens in the renderer on Apply.
 */
export interface ViewerSize {
  width: number;
  height: number;
}

export interface ViewerOpenInput {
  dataUrl: string;
  title: string;
  /** Draft attachments are editable; transcript/tool images are read-only. */
  editable?: boolean;
}

export interface ViewerOpenResult {
  ok: boolean;
  token: string | null;
}

export interface ViewerEditPayload {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ViewerApplied extends ViewerEditPayload {
  token: string;
}

export const VIEWER_MIN_CROP_PX = 8;
export const VIEWER_MIN_REDACT_PX = 4;

/** Screen point → image pixel coordinates for the rendered (fit) box. */
export function imagePoint(
  client: { x: number; y: number },
  box: { left: number; top: number; width: number; height: number },
  natural: ViewerSize
): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((client.x - box.left) / box.width) * natural.width,
    y: ((client.y - box.top) / box.height) * natural.height,
  };
}

/** A drag between two image points, clamped into the image. */
export function imageRectBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
  natural: ViewerSize
): CaptureRect {
  const rect = normalizeRect(start, end);
  const x = Math.max(0, Math.min(rect.x, natural.width));
  const y = Math.max(0, Math.min(rect.y, natural.height));
  return {
    x,
    y,
    width: Math.max(0, Math.min(rect.width, natural.width - x)),
    height: Math.max(0, Math.min(rect.height, natural.height - y)),
  };
}

/** The crop actually applied: the chosen rect, or the whole image. */
export function effectiveCrop(crop: CaptureRect | null, natural: ViewerSize): CaptureRect {
  if (!crop || crop.width < VIEWER_MIN_CROP_PX || crop.height < VIEWER_MIN_CROP_PX) {
    return { x: 0, y: 0, width: natural.width, height: natural.height };
  }
  return crop;
}

/** A redact rect expressed in crop-relative pixels (drawn in the exported image). */
export function redactWithinCrop(redact: CaptureRect, crop: CaptureRect): CaptureRect {
  return {
    x: Math.max(0, redact.x - crop.x),
    y: Math.max(0, redact.y - crop.y),
    width: Math.max(0, Math.min(redact.width, crop.width - Math.max(0, redact.x - crop.x))),
    height: Math.max(0, Math.min(redact.height, crop.height - Math.max(0, redact.y - crop.y))),
  };
}

/** Drop rects that fall (mostly) outside the crop — they would draw nothing. */
export function visibleRedacts(redacts: readonly CaptureRect[], crop: CaptureRect): CaptureRect[] {
  return redacts
    .map((rect) => redactWithinCrop(rect, crop))
    .filter((rect) => rect.width >= 1 && rect.height >= 1);
}

/**
 * Apply an edit to the draft attachment it came from. Positional, with a
 * type guard: the draft may have changed while the viewer was open, and a
 * different attachment must never be overwritten.
 */
export function replaceEditedAttachment<T extends { type: string; data: string }>(
  attachments: readonly T[],
  index: number,
  edit: { dataUrl: string; width: number; height: number }
): T[] {
  return attachments.map((attachment, position) => {
    if (position !== index || attachment.type === 'pdf') {
      return attachment;
    }
    const capture = (attachment as { capture?: Record<string, unknown> }).capture;
    return {
      ...attachment,
      data: edit.dataUrl,
      ...(capture
        ? { capture: { ...capture, width: edit.width, height: edit.height } }
        : {}),
    } as T;
  });
}

/** What a click in the editor does, so the empty state can explain itself. */
export function editHint(mode: 'crop' | 'redact', crop: CaptureRect | null): string {
  if (mode === 'redact') {
    return 'Drag over anything private to black it out';
  }
  return crop ? 'Drag again to redo the crop · Apply to keep it' : 'Drag the area to keep';
}
