import {
  displayAtPoint,
  regionLabel,
  resolveAutoWindow,
  windowLabel,
  type CaptureDisplayLike,
  type CaptureOutcome,
  type CapturePoint,
  type CaptureRequest,
  type CaptureSourceList,
  type CaptureWindowRect,
} from '@shared/capture';
import { TEXT } from '@shared/constants/text';
import type { CaptureGeometryProvider } from './geometry';
import { nativeRectsToDip } from './geometry';
import type { CaptureSources, CaptureSize } from './sources';
import type { EncodedImage } from './region';

const SOURCE_CACHE_MS = 20_000;

export interface CaptureServiceDeps {
  sources: CaptureSources;
  geometry: CaptureGeometryProvider;
  /** Native OS region capture (none → the row is not offered). */
  region: { available(): Promise<boolean>; capture(): Promise<EncodedImage | null> };
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
}

function pixelSize(display: CaptureDisplayLike): CaptureSize {
  const scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
  return {
    width: Math.max(1, Math.round(display.bounds.width * scale)),
    height: Math.max(1, Math.round(display.bounds.height * scale)),
  };
}

function failure(reason: 'cancelled' | 'unavailable' | 'failed', message?: string): CaptureOutcome {
  return { ok: false, reason, ...(message ? { message } : {}) };
}

function sourceKind(id: string): 'screen' | 'window' {
  return id.startsWith('screen:') ? 'screen' : 'window';
}

function dataUrl(image: EncodedImage): string {
  return `data:image/jpeg;base64,${image.jpeg.toString('base64')}`;
}

/**
 * The capture engine (plan 80, rebuilt 2026-11-12 after owner feedback).
 *
 * There is no frozen-frame overlay any more: a window is captured from its own
 * source image (never occluded, never stitched from a stale screen frame), a
 * region is the OS's own selection tool, and a display is its own source. The
 * ladder (`auto`) resolves the pointer's window, then the window behind ours,
 * then the display.
 */
export class CaptureService {
  private active: Promise<CaptureOutcome> | null = null;
  private sourceCache: { at: number; value: CaptureSourceList } | null = null;
  private warmed = false;

  constructor(private readonly deps: CaptureServiceDeps) {}

  /** Single-flight: a second request shares the running session. */
  public begin(request: CaptureRequest): Promise<CaptureOutcome> {
    if (this.active) {
      return this.active;
    }
    this.active = this.run(request).finally(() => {
      this.active = null;
    });
    return this.active;
  }

  /**
   * Pay the first-call costs (tool probe, tesseract probe) at boot, so the
   * first time the mode grid opens it is already warm. Never awaited.
   */
  public warmup(): void {
    if (this.warmed) {
      return;
    }
    this.warmed = true;
    void this.deps.region.available().catch(() => false);
  }

  /** Region support alone: a cached probe, no capture enumeration. */
  public async regionAvailable(): Promise<boolean> {
    return this.deps.region.available().catch(() => false);
  }

  /** The picker's rows: screens, windows (ours excluded), and region support. */
  public async listSources(): Promise<CaptureSourceList> {
    const now = this.deps.now?.() ?? Date.now();
    if (this.sourceCache && now - this.sourceCache.at < SOURCE_CACHE_MS) {
      return this.sourceCache.value;
    }
    const display = this.pickDisplay() ?? this.deps.displays()[0];
    const size = display ? pixelSize(display) : { width: 1280, height: 800 };
    const [screens, windows, region] = await Promise.all([
      this.deps.sources.screenRows(size),
      this.deps.sources.windowRows(size),
      this.deps.region.available().catch(() => false),
    ]);
    const own = this.deps.ownWindowTitles();
    const value: CaptureSourceList = {
      screens,
      windows: windows.filter((row) => !own.some((title) => row.name.trim().toLowerCase().startsWith(title.trim().toLowerCase()))),
      region,
    };
    // Window enumeration is the expensive call; a short cache makes reopening
    // the picker (or drilling in twice) instant. Captures clear it below.
    this.sourceCache = { at: now, value };
    return value;
  }

  /** A capture changes what is on screen; the next list must be fresh. */
  private invalidateSources(): void {
    this.sourceCache = null;
  }

  private async run(request: CaptureRequest): Promise<CaptureOutcome> {
    this.invalidateSources();
    await this.deps.hideSurfaces();
    try {
      if (request.intent === 'region') {
        return await this.captureRegion();
      }
      const display = this.pickDisplay(request.displayId);
      if (!display && request.intent !== 'source') {
        return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
      }
      if (request.intent === 'source') {
        return await this.captureSourceRow(request.sourceId, display);
      }
      if (request.intent === 'display' || !display) {
        return display ? await this.captureDisplay(display) : failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
      }
      return await this.captureAuto(display);
    } catch (error) {
      return failure('failed', (error as Error)?.message ?? String(error));
    } finally {
      this.deps.revealSurfaces();
    }
  }

  private pickDisplay(preferredId?: number): CaptureDisplayLike | null {
    const displays = this.deps.displays();
    if (preferredId !== undefined) {
      const preferred = displays.find((display) => display.id === preferredId);
      if (preferred) {
        return preferred;
      }
    }
    return displayAtPoint(displays, this.deps.cursorPoint()) ?? displays[0] ?? null;
  }

  // ------------------------------------------------------------------ region

  private async captureRegion(): Promise<CaptureOutcome> {
    if (!(await this.deps.region.available().catch(() => false))) {
      return failure('unavailable', TEXT.CAPTURE_REGION_UNAVAILABLE);
    }
    const image = await this.deps.region.capture();
    if (!image) {
      return failure('cancelled', TEXT.CAPTURE_CANCELLED);
    }
    return {
      ok: true,
      dataUrl: dataUrl(image),
      meta: {
        kind: 'region',
        label: regionLabel({ x: 0, y: 0, width: image.width, height: image.height }),
        width: image.width,
        height: image.height,
        ...(this.pickDisplay() ? { displayId: this.pickDisplay()!.id } : {}),
      },
    };
  }

  // ------------------------------------------------------------------ source

  private async captureSourceRow(sourceId: string | undefined, display: CaptureDisplayLike | null): Promise<CaptureOutcome> {
    if (!sourceId) {
      return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
    }
    const size = display ? pixelSize(display) : { width: 2560, height: 1600 };
    const captured = await this.deps.sources.captureSource(sourceId, size);
    if (!captured) {
      return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
    }
    const kind = sourceKind(sourceId);
    return {
      ok: true,
      dataUrl: dataUrl(captured),
      meta: {
        kind: kind === 'screen' ? 'display' : 'window',
        label: kind === 'screen' ? TEXT.CAPTURE_LABEL_DISPLAY : TEXT.CAPTURE_LABEL_WINDOW_UNKNOWN,
        width: captured.width,
        height: captured.height,
        ...(display ? { displayId: display.id } : {}),
      },
    };
  }

  // ------------------------------------------------------------------ ladder

  private async captureAuto(display: CaptureDisplayLike): Promise<CaptureOutcome> {
    const windows = await this.windowsInDip(display);
    const target = resolveAutoWindow({
      windows,
      point: this.deps.cursorPoint(),
      ownTitles: this.deps.ownWindowTitles(),
    });
    if (target) {
      const captured = await this.captureWindow({ title: target.title, app: target.app }, display);
      if (captured) {
        return captured;
      }
    }
    return this.captureDisplay(display);
  }

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
      dataUrl: dataUrl(captured),
      meta: {
        kind: 'display',
        label: TEXT.CAPTURE_LABEL_DISPLAY,
        width: captured.width,
        height: captured.height,
        displayId: display.id,
      },
    };
  }

  private async captureWindow(
    window: { title: string; app?: string },
    display: CaptureDisplayLike
  ): Promise<CaptureOutcome | null> {
    const size = pixelSize(display);
    const sources = await this.deps.sources.windowSources(size);
    const match =
      sources.find((source) => source.name === window.title) ??
      sources.find((source) => source.name.trim() === window.title.trim()) ??
      sources.find(
        (source) => source.name.length > 0 && (source.name.includes(window.title) || window.title.includes(source.name))
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
      dataUrl: dataUrl(captured),
      meta: {
        kind: 'window',
        label: windowLabel(window),
        width: captured.width,
        height: captured.height,
        displayId: display.id,
      },
    };
  }

  /**
   * Capture a window by title (the agent tool's `windowName`): same hide /
   * reveal lifecycle as `begin`.
   */
  public async captureNamedWindow(name: string): Promise<CaptureOutcome> {
    await this.deps.hideSurfaces();
    try {
      const display = this.pickDisplay();
      if (!display) {
        return failure('unavailable', TEXT.CAPTURE_UNAVAILABLE);
      }
      const captured = await this.captureWindow({ title: name }, display);
      return captured ?? failure('unavailable', `No window matching '${name}' is open.`);
    } catch (error) {
      return failure('failed', (error as Error)?.message ?? String(error));
    } finally {
      this.deps.revealSurfaces();
    }
  }

  private async windowsInDip(display: CaptureDisplayLike): Promise<CaptureWindowRect[]> {
    const native = await this.deps.geometry.windows();
    if (!native || native.length === 0) {
      return [];
    }
    return nativeRectsToDip(native, { scaleMode: this.deps.geometry.scaleMode, reference: display });
  }
}
