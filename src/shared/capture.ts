import { TEXT, interpolate } from './constants/text';

/**
 * The capture contract (plan 80): one ladder, one gesture language, one
 * result shape for every surface and every OS.
 *
 * Intents are about *who decides the target*:
 * - `auto`    — the pointer decides (hotkey, agent tool): pointer window →
 *               window behind the surface → display under the pointer.
 * - `overlay` — the user decides in the frozen-frame overlay (any visible
 *               button: the pointer is on the button, so nothing is inferable).
 * - `display` — no UI at all, the display under the pointer.
 */
export type CaptureIntent = 'auto' | 'overlay' | 'display';

export const CAPTURE_INTENTS: readonly CaptureIntent[] = ['auto', 'overlay', 'display'];

export interface CapturePoint {
  x: number;
  y: number;
}

/** A rectangle in DIP. Screen-global unless a function says display-local. */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureTargetKind = 'window' | 'region' | 'display';

/** The subset of Electron's `Display` the engine needs (keeps pure math pure). */
export interface CaptureDisplayLike {
  id: number;
  bounds: CaptureRect;
  scaleFactor: number;
}

/** A window as the geometry provider reports it: DIP, screen-global, top-first order. */
export interface CaptureWindowRect {
  title: string;
  app?: string;
  rect: CaptureRect;
}

/** What rides along with a `screen-capture` attachment (chip label + Adjust). */
export interface CaptureAttachmentMeta {
  kind: CaptureTargetKind;
  label: string;
  width: number;
  height: number;
  displayId?: number;
  /** Display-local DIP rect of a region capture, so Adjust can re-arm it. */
  rect?: CaptureRect;
}

export interface CaptureSuccess {
  ok: true;
  dataUrl: string;
  meta: CaptureAttachmentMeta;
}

export type CaptureFailureReason = 'cancelled' | 'unavailable' | 'failed';

export interface CaptureFailure {
  ok: false;
  reason: CaptureFailureReason;
  message?: string;
}

export type CaptureOutcome = CaptureSuccess | CaptureFailure;

/** One capture request from any surface. */
export interface CaptureRequest {
  intent: CaptureIntent;
  /** Re-arm a previous region (Adjust) — reuses the retained frame when warm. */
  initial?: { displayId: number; rect: CaptureRect };
}

/** The overlay's verdict: a region, a window from the armed hover, or the display. */
export type CaptureSelection =
  | { kind: 'region'; rect: CaptureRect }
  | { kind: 'window'; window: CaptureWindowRect }
  | { kind: 'display' };

/**
 * What the overlay window receives. Everything geometric is display-local
 * DIP, so the renderer does no display math at all (plan 80, D3).
 */
export interface CaptureOverlaySession {
  /** The session nonce; a stale commit is refused by main. */
  sessionId: string;
  display: { id: number; width: number; height: number; scaleFactor: number };
  /** Bounded JPEG data URL of the frozen display. */
  preview: string;
  /** Windows on this display, top-first, display-local DIP. */
  windows: CaptureWindowRect[];
  /** The ladder's pick — what a click grabs before the pointer moves. */
  armed: CaptureWindowRect | null;
  /** Previous region to re-arm (Adjust). */
  initialRect?: CaptureRect;
  hint: string;
}

/** Pointer travel (DIP) below which a press is a click, not a drag. */
export const CAPTURE_MIN_DRAG_DIP = 6;
/** Press duration above which the same travel still counts as a drag attempt. */
export const CAPTURE_CLICK_MAX_MS = 300;
/** A committed region smaller than this is treated as a click. */
export const CAPTURE_MIN_REGION_DIP = 8;
/** Attachment long-edge cap: vision tokens and SQLite stay bounded. */
export const CAPTURE_MAX_EDGE_PX = 1600;
export const CAPTURE_JPEG_QUALITY = 82;
export const CAPTURE_FRAME_TTL_MS = 30_000;
export const CAPTURE_FRAME_LIMIT = 2;
/** Let the compositor repaint after hiding our own surfaces (X11). */
export const CAPTURE_HIDE_SETTLE_MS = 120;

// ---------------------------------------------------------------- rect math

export function rectWidth(rect: CaptureRect): number {
  return Math.max(0, rect.width);
}

export function rectContains(rect: CaptureRect, point: CapturePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

export function normalizeRect(start: CapturePoint, end: CapturePoint): CaptureRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Keep a rect inside bounds, preserving its top-left when it already fits. */
export function clampRect(rect: CaptureRect, bounds: CaptureRect): CaptureRect {
  const width = Math.max(1, Math.min(Math.round(rect.width), bounds.width));
  const height = Math.max(1, Math.min(Math.round(rect.height), bounds.height));
  const x = Math.max(bounds.x, Math.min(Math.round(rect.x), bounds.x + bounds.width - width));
  const y = Math.max(bounds.y, Math.min(Math.round(rect.y), bounds.y + bounds.height - height));
  return { x, y, width, height };
}

/** DIP rect → native pixel rect on one display, clamped to the pixel surface. */
export function toPixels(
  rect: CaptureRect,
  scaleFactor: number,
  pixelBounds: { width: number; height: number }
): CaptureRect {
  const scale = scaleFactor > 0 ? scaleFactor : 1;
  return clampRect(
    {
      x: rect.x * scale,
      y: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    },
    { x: 0, y: 0, width: pixelBounds.width, height: pixelBounds.height }
  );
}

/** Long-edge fit, never upscaling. */
export function scaleToFit(
  size: { width: number; height: number },
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge || longest === 0) {
    return { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

// ------------------------------------------------------------- display math

export function displayAtPoint(
  displays: readonly CaptureDisplayLike[],
  point: CapturePoint
): CaptureDisplayLike | null {
  const hit = displays.find((display) => rectContains(display.bounds, point));
  if (hit) {
    return hit;
  }
  return displays[0] ?? null;
}

export function toDisplayLocal(rect: CaptureRect, display: CaptureDisplayLike): CaptureRect {
  return { x: rect.x - display.bounds.x, y: rect.y - display.bounds.y, width: rect.width, height: rect.height };
}

export function toDisplayLocalPoint(point: CapturePoint, display: CaptureDisplayLike): CapturePoint {
  return { x: point.x - display.bounds.x, y: point.y - display.bounds.y };
}

// ------------------------------------------------------------- window ladder

function normalizedTitle(title: string): string {
  return title.trim().toLowerCase();
}

/** Our own surfaces are never capture targets, whatever the OS reports. */
export function isOwnWindowTitle(title: string, ownTitles: readonly string[]): boolean {
  const needle = normalizedTitle(title);
  if (!needle) {
    return false;
  }
  return ownTitles.some((own) => {
    const candidate = normalizedTitle(own);
    return candidate.length > 0 && (needle === candidate || needle.startsWith(candidate));
  });
}

/** Top-first hit test: the first window containing the point wins. */
export function hitTestWindows(
  windows: readonly CaptureWindowRect[],
  point: CapturePoint
): CaptureWindowRect | null {
  for (const window of windows) {
    if (rectContains(window.rect, point) && window.rect.width > 0 && window.rect.height > 0) {
      return window;
    }
  }
  return null;
}

/**
 * The `auto` ladder: the window under the pointer, else the top-most window
 * that is not ours (the one behind the surface the user just pressed), else
 * `null` — the caller falls through to the display.
 */
export function resolveAutoWindow(input: {
  windows: readonly CaptureWindowRect[];
  point: CapturePoint;
  ownTitles: readonly string[];
}): CaptureWindowRect | null {
  const usable = input.windows.filter(
    (window) => window.rect.width > 1 && window.rect.height > 1 && !isOwnWindowTitle(window.title, input.ownTitles)
  );
  const pointer = hitTestWindows(usable, input.point);
  if (pointer) {
    return pointer;
  }
  return usable[0] ?? null;
}

// ----------------------------------------------------------------- gestures

export function classifyGesture(
  start: CapturePoint,
  end: CapturePoint,
  durationMs: number
): 'click' | 'drag' {
  const travel = Math.hypot(end.x - start.x, end.y - start.y);
  if (travel >= CAPTURE_MIN_DRAG_DIP) {
    return 'drag';
  }
  return durationMs > CAPTURE_CLICK_MAX_MS ? 'drag' : 'click';
}

/** Resolve a finished gesture into a selection (the overlay's whole state machine). */
export function selectionFromGesture(input: {
  start: CapturePoint;
  end: CapturePoint;
  durationMs: number;
  hovered: CaptureWindowRect | null;
}): CaptureSelection {
  const gesture = classifyGesture(input.start, input.end, input.durationMs);
  const rect = normalizeRect(input.start, input.end);
  if (gesture === 'drag' && rect.width >= CAPTURE_MIN_REGION_DIP && rect.height >= CAPTURE_MIN_REGION_DIP) {
    return { kind: 'region', rect };
  }
  return input.hovered ? { kind: 'window', window: input.hovered } : { kind: 'display' };
}

// ------------------------------------------------------------------- labels

export function windowLabel(window: { title: string; app?: string }): string {
  const title = window.title.trim();
  const app = window.app?.trim();
  if (app && title) {
    return interpolate(TEXT.CAPTURE_LABEL_WINDOW, { app, title });
  }
  return title || app || TEXT.CAPTURE_LABEL_WINDOW_UNKNOWN;
}

export function regionLabel(rect: CaptureRect): string {
  return interpolate(TEXT.CAPTURE_LABEL_REGION, {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  });
}
