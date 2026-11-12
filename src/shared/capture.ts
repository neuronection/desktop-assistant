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
export type CaptureIntent = 'auto' | 'region' | 'display' | 'source';

export const CAPTURE_INTENTS: readonly CaptureIntent[] = ['auto', 'region', 'display', 'source'];

/**
 * The user's default capture style (plan 80 follow-up). It answers one
 * question: what should a press do when the pointer still means something
 * (HUD knob, hotkey). `window` = the window under the pointer, `region` = the
 * overlay, `display` = the whole display.
 */
export type CaptureStyle = 'window' | 'region' | 'display';

export const CAPTURE_STYLES: readonly CaptureStyle[] = ['window', 'region', 'display'];

export function intentForCaptureStyle(style: CaptureStyle | undefined): CaptureIntent {
  if (style === 'region') {
    return 'region';
  }
  if (style === 'display') {
    return 'display';
  }
  return 'auto';
}

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
  /** `source` intent: the `desktopCapturer` id the user picked from the list. */
  sourceId?: string;
  /** `display` intent: which display (defaults to the one under the pointer). */
  displayId?: number;
}

/** What the mode grid may offer (plan 82); the cheap half of the report. */
export interface CaptureCapabilitiesLike {
  platform: string;
  egress: string;
  region: boolean;
  screens: number;
  ocr: {
    local: boolean;
    model: boolean;
    provider?: string;
    modelId?: string;
    allowed: boolean;
    egress: string;
  };
}

/** One row of the capture source list (screens and windows). */
export interface CaptureSourceRow {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  displayId?: number;
  /** Data URL of the app icon, when the OS provides one. */
  icon?: string;
}

export interface CaptureSourceList {
  screens: CaptureSourceRow[];
  windows: CaptureSourceRow[];
  /** True when the OS offers a native region tool on this machine. */
  region: boolean;
}

/** Attachment long-edge cap: vision tokens and SQLite stay bounded. */
export const CAPTURE_MAX_EDGE_PX = 1600;
export const CAPTURE_JPEG_QUALITY = 82;
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
