import {
  displayAtPoint,
  normalizeRect,
  regionLabel,
  resolveAutoWindow,
  toDisplayLocal,
  toPixels,
  windowLabel,
  type CaptureDisplayLike,
  type CaptureIntent,
  type CaptureOutcome,
  type CaptureOverlaySession,
  type CapturePoint,
  type CaptureRequest,
  type CaptureRect,
  type CaptureSelection,
  type CaptureWindowRect,
} from '@shared/capture';
import { TEXT } from '@shared/constants/text';
import type { CaptureGeometryProvider } from './geometry';
import { nativeRectsToDip } from './geometry';
import type { CaptureFrame, CaptureFrameStore } from './frames';
import { cropAndEncode, type CaptureSources, type CaptureSize, type NativeImageLike } from './sources';

export interface CaptureOverlayReply {
  selection: CaptureSelection | null;
}

export interface CaptureOverlayPort {
  open(session: CaptureOverlaySession): Promise<CaptureOverlayReply>;
  close(): void;
}

export interface CaptureServiceDeps {
  sources: CaptureSources;
  geometry: CaptureGeometryProvider;
  frames: CaptureFrameStore;
  overlay: CaptureOverlayPort;
  displays(): CaptureDisplayLike[];
  cursorPoint(): CapturePoint;
  ownWindowTitles(): string[];
  /** Hide every visible surface of ours and let the compositor settle. */
  hideSurfaces(): Promise<void>;
  /** Put back exactly what the user had on screen. */
  revealSurfaces(): void;
  platform?: NodeJS.Platform;
  isWayland?(): boolean;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

const PORTAL_PICK_SIZE: CaptureSize = { width: 2560, height: 1600 };

function pixelSize(display: CaptureDisplayLike): CaptureSize {
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
  return {
    width: Math.max(1, Math.round(display.bounds.width * scale)),
    height: Math.max(1, Math.round(display.bounds.height * scale)),
  };
}

function failure(
  reason: 'cancelled' | 'unavailable' | 'failed',
  message?: string
): CaptureOutcome {
  return { ok: false, reason, ...(message ? { message } : {}) };
}

/**
 * The capture engine (plan 80): one ladder, one overlay, one result shape.
 *
 * Every surface calls `begin`. Visible buttons pass `overlay` (the pointer is
 * on the button — nothing is inferable); the hotkey and the agent tool pass
 * `auto` (the pointer means something). Wayland short-circuits to the portal.
 */
export class CaptureService {
  private active: Promise<CaptureOutcome> | null = null;
  private sessionSeq = 0;

  constructor(private readonly deps: CaptureServiceDeps) {}

  /** Single-flight: a second request shares the running session. */
  public begin(request: CaptureRequest): Promise<CaptureOutcome> {
    if (this.active) {
      return this.active;
    }
    this.active = this.run(request.intent, { initial: request.initial }).finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async run(
    intent: CaptureIntent,
    options: { initial?: { displayId: number; rect: CaptureRect } }
  ): Promise<CaptureOutcome> {
    await this.deps.hideSurfaces();
    try {
      const display = this.pickDisplay(options.initial?.displayId);
      if (!display) {
        return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
      }
      if (this.onWayland()) {
        return await this.capturePortalPick(display);
      }
      if (intent === 'overlay') {
        return await this.captureThroughOverlay(display, options.initial?.rect);
      }
      if (intent === 'display') {
        return await this.captureDisplay(display);
      }
      return await this.captureAuto(display);
    } catch (error) {
      return failure('failed', (error as Error)?.message ?? String(error));
    } finally {
      this.deps.revealSurfaces();
    }
  }

  private onWayland(): boolean {
    if (this.deps.isWayland) {
      return this.deps.isWayland();
    }
    return this.deps.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';
  }

  private pickDisplay(preferredId?: number): CaptureDisplayLike | null {
    const displays = this.deps.displays();
    if (preferredId !== undefined) {
      const preferred = displays.find((display) => display.id === preferredId);
      if (preferred) {
        return preferred;
      }
    }
    return displayAtPoint(displays, this.deps.cursorPoint()) ?? null;
  }

  // ------------------------------------------------------------- auto ladder

  private async captureAuto(display: CaptureDisplayLike): Promise<CaptureOutcome> {
    const windows = await this.windowsInDip(display);
    const target = resolveAutoWindow({
      windows,
      point: this.deps.cursorPoint(),
      ownTitles: this.deps.ownWindowTitles(),
    });
    if (target) {
      const captured = await this.captureWindow(target, display);
      if (captured) {
        return captured;
      }
    }
    return this.captureDisplay(display);
  }

  private async captureWindow(
    window: CaptureWindowRect,
    display: CaptureDisplayLike
  ): Promise<CaptureOutcome | null> {
    const size = pixelSize(display);
    const sources = await this.deps.sources.windowSources(size);
    const match =
      sources.find((source) => source.name === window.title) ??
      sources.find((source) => source.name.trim() === window.title.trim()) ??
      sources.find(
        (source) =>
          source.name.length > 0 &&
          (source.name.includes(window.title) || window.title.includes(source.name))
      );
    if (!match) {
      return null;
    }
    const captured = await this.deps.sources.captureSource(match.id, size);
    if (!captured) {
      return null;
    }
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${captured.jpeg.toString('base64')}`,
      meta: {
        kind: 'window',
        label: windowLabel(window),
        width: captured.width,
        height: captured.height,
        displayId: display.id,
      },
    };
  }

  // ---------------------------------------------------------------- display

  private async captureDisplay(display: CaptureDisplayLike): Promise<CaptureOutcome> {
    const size = pixelSize(display);
    const source = await this.deps.sources.screenSource(display.id, size);
    if (!source) {
      return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
    }
    const captured = await this.deps.sources.captureSource(source.id, size);
    if (!captured) {
      return failure('failed', TEXT.CAPTURE_UNAVAILABLE);
    }
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${captured.jpeg.toString('base64')}`,
      meta: {
        kind: 'display',
        label: TEXT.CAPTURE_LABEL_DISPLAY,
        width: captured.width,
        height: captured.height,
        displayId: display.id,
      },
    };
  }

  /** Wayland: the OS picker *is* the selection (plan 80, D8). */
  private async capturePortalPick(display: CaptureDisplayLike): Promise<CaptureOutcome> {
    const sources = await this.deps.sources.pickAnySource(PORTAL_PICK_SIZE);
    if (sources.length === 0) {
      return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
    }
    const chosen = sources[0];
    const captured = await this.deps.sources.captureSource(chosen.id, PORTAL_PICK_SIZE);
    if (!captured) {
      return failure('failed', TEXT.CAPTURE_UNAVAILABLE);
    }
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${captured.jpeg.toString('base64')}`,
      meta: {
        kind: 'display',
        label: chosen.name?.trim() ? windowLabel({ title: chosen.name }) : TEXT.CAPTURE_LABEL_PICKED,
        width: captured.width,
        height: captured.height,
        displayId: display.id,
      },
    };
  }

  // ----------------------------------------------------------------- overlay

  private async captureThroughOverlay(
    display: CaptureDisplayLike,
    initialRect?: CaptureRect
  ): Promise<CaptureOutcome> {
    const frame = (await this.frame(display)) ?? null;
    if (!frame) {
      return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
    }
    const sessionId = `capture-${++this.sessionSeq}`;
    const windows = await this.windowsInLocalDip(display);
    const armed = resolveAutoWindow({
      windows,
      point: {
        x: this.deps.cursorPoint().x - display.bounds.x,
        y: this.deps.cursorPoint().y - display.bounds.y,
      },
      ownTitles: this.deps.ownWindowTitles(),
    });
    const reply = await this.deps.overlay.open({
      sessionId,
      display: {
        id: display.id,
        width: Math.max(1, Math.round(display.bounds.width)),
        height: Math.max(1, Math.round(display.bounds.height)),
        scaleFactor: display.scaleFactor,
      },
      preview: frame.preview,
      windows,
      armed,
      initialRect,
      hint: TEXT.CAPTURE_OVERLAY_HINT,
    });
    const selection = reply.selection;
    if (!selection) {
      return failure('cancelled', TEXT.CAPTURE_CANCELLED);
    }
    if (selection.kind === 'region') {
      return this.cropRegion(frame, display, selection.rect);
    }
    if (selection.kind === 'window') {
      const captured = await this.captureWindow(this.toGlobalWindow(selection.window, display), display);
      if (captured) {
        return captured;
      }
      return this.cropRegion(frame, display, selection.window.rect);
    }
    return this.captureDisplay(display);
  }

  private async frame(display: CaptureDisplayLike): Promise<CaptureFrame | null> {
    const cached = this.deps.frames.get(display.id);
    if (cached) {
      return cached;
    }
    const size = pixelSize(display);
    const image = await this.deps.sources.displayFrame(display.id, size);
    if (!image) {
      return null;
    }
    const preview = this.previewDataUrl(image, display);
    if (!preview) {
      return null;
    }
    const frame: CaptureFrame = {
      display,
      image,
      preview,
      takenAt: this.deps.now?.() ?? Date.now(),
    };
    this.deps.frames.put(frame);
    return frame;
  }

  private previewDataUrl(image: NativeImageLike, display: CaptureDisplayLike): string | null {
    const width = Math.max(1, Math.min(Math.round(display.bounds.width), 2560));
    try {
      const preview = image.resize({ width, quality: 'better' });
      const jpeg = preview.toJPEG(72);
      if (!jpeg || jpeg.length === 0) {
        return null;
      }
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private async cropRegion(
    frame: CaptureFrame,
    display: CaptureDisplayLike,
    rect: CaptureRect
  ): Promise<CaptureOutcome> {
    const local = this.clampToDisplay(rect, display);
    const pixels = toPixels(local, display.scaleFactor, {
      width: frame.image.getSize().width,
      height: frame.image.getSize().height,
    });
    const captured = cropAndEncode(frame.image, pixels);
    if (!captured) {
      return failure('failed', TEXT.CAPTURE_UNAVAILABLE);
    }
    return {
      ok: true,
      dataUrl: `data:image/jpeg;base64,${captured.jpeg.toString('base64')}`,
      meta: {
        kind: 'region',
        label: regionLabel(local),
        width: captured.width,
        height: captured.height,
        displayId: display.id,
        rect: local,
      },
    };
  }

  // ------------------------------------------------------------------ windows

  private async windowsInDip(display: CaptureDisplayLike): Promise<CaptureWindowRect[]> {
    const native = await this.deps.geometry.windows();
    if (!native || native.length === 0) {
      return [];
    }
    return nativeRectsToDip(native, {
      scaleMode: this.deps.geometry.scaleMode,
      reference: display,
    });
  }

  private async windowsInLocalDip(display: CaptureDisplayLike): Promise<CaptureWindowRect[]> {
    const global = await this.windowsInDip(display);
    return global.map((window) => this.toLocalWindow(window, display));
  }

  private toLocalWindow(window: CaptureWindowRect, display: CaptureDisplayLike): CaptureWindowRect {
    return { ...window, rect: toDisplayLocal(window.rect, display) };
  }

  private toGlobalWindow(window: CaptureWindowRect, display: CaptureDisplayLike): CaptureWindowRect {
    return {
      ...window,
      rect: {
        x: window.rect.x + display.bounds.x,
        y: window.rect.y + display.bounds.y,
        width: window.rect.width,
        height: window.rect.height,
      },
    };
  }

  private toGlobal(windows: CaptureWindowRect[], display: CaptureDisplayLike): CaptureWindowRect[] {
    return windows.map((window) => this.toGlobalWindow(window, display));
  }

  private clampToDisplay(rect: CaptureRect, display: CaptureDisplayLike): CaptureRect {
    const normalized = normalizeRect({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height });
    const maxWidth = Math.max(1, Math.round(display.bounds.width));
    const maxHeight = Math.max(1, Math.round(display.bounds.height));
    const width = Math.max(1, Math.min(Math.round(normalized.width), maxWidth));
    const height = Math.max(1, Math.min(Math.round(normalized.height), maxHeight));
    return {
      x: Math.max(0, Math.min(Math.round(normalized.x), maxWidth - width)),
      y: Math.max(0, Math.min(Math.round(normalized.y), maxHeight - height)),
      width,
      height,
    };
  }
}
