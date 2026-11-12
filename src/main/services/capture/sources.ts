import { CAPTURE_JPEG_QUALITY, CAPTURE_MAX_EDGE_PX, scaleToFit, type CaptureRect } from '@shared/capture';

/** The structural slice of Electron's `NativeImage` the engine needs. */
export interface NativeImageLike {
  getSize(): { width: number; height: number };
  toJPEG(quality: number): Buffer;
  crop(rect: CaptureRect): NativeImageLike;
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike;
}

export interface DesktopSourceLike {
  id: string;
  name: string;
  display_id?: string;
  thumbnail: NativeImageLike;
}

export interface CaptureSourcesDeps {
  getSources(options: {
    types: Array<'screen' | 'window'>;
    thumbnailSize: { width: number; height: number };
  }): Promise<DesktopSourceLike[]>;
}

export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * The one adapter over `desktopCapturer` (plan 80, D4): screens and windows are
 * read from their own source image, regions crop a frozen screen frame.
 */
export class CaptureSources {
  constructor(private readonly deps: CaptureSourcesDeps) {}

  private async sources(types: Array<'screen' | 'window'>, size: CaptureSize): Promise<DesktopSourceLike[]> {
    try {
      return await this.deps.getSources({
        types,
        thumbnailSize: {
          width: Math.max(1, Math.round(size.width)),
          height: Math.max(1, Math.round(size.height)),
        },
      });
    } catch {
      return [];
    }
  }

  public async screenSource(displayId: number, size: CaptureSize): Promise<DesktopSourceLike | null> {
    const sources = await this.sources(['screen'], size);
    return sources.find((source) => source.display_id === String(displayId)) ?? sources[0] ?? null;
  }

  /** The unfrozen frame of one display, at that display's native pixel size. */
  public async displayFrame(displayId: number, size: CaptureSize): Promise<NativeImageLike | null> {
    const source = await this.screenSource(displayId, size);
    return source?.thumbnail ?? null;
  }

  public async windowSources(size: CaptureSize): Promise<DesktopSourceLike[]> {
    return this.sources(['window'], size);
  }

  /** Wayland: ask the portal for anything the user is willing to share. */
  public async pickAnySource(size: CaptureSize): Promise<DesktopSourceLike[]> {
    return this.sources(['screen', 'window'], size);
  }

  /**
   * Capture one source and return a bounded JPEG: `scaleToFit` keeps the long
   * edge at or under `CAPTURE_MAX_EDGE_PX` (vision tokens + SQLite stay small).
   */
  public async captureSource(
    sourceId: string,
    size: CaptureSize
  ): Promise<{ jpeg: Buffer; width: number; height: number } | null> {
    const sources = await this.sources(['window', 'screen'], size);
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      return null;
    }
    return jpegFromImage(source.thumbnail);
  }
}

export function cropAndEncode(
  image: NativeImageLike,
  rect: CaptureRect
): { jpeg: Buffer; width: number; height: number } | null {
  const cropped = image.crop(rect);
  return jpegFromImage(cropped);
}

function jpegFromImage(image: NativeImageLike): { jpeg: Buffer; width: number; height: number } | null {
  const size = image.getSize();
  if (size.width < 1 || size.height < 1) {
    return null;
  }
  const fitted = scaleToFit(size, CAPTURE_MAX_EDGE_PX);
  const final = fitted.width === size.width && fitted.height === size.height
    ? image
    : image.resize({ width: fitted.width, quality: 'better' });
  const jpeg = final.toJPEG(CAPTURE_JPEG_QUALITY);
  if (!jpeg || jpeg.length === 0) {
    return null;
  }
  const finalSize = final.getSize();
  return { jpeg, width: finalSize.width, height: finalSize.height };
}
