import { CAPTURE_FRAME_LIMIT, CAPTURE_FRAME_TTL_MS, type CaptureDisplayLike } from '@shared/capture';
import type { NativeImageLike } from './sources';

export interface CaptureFrame {
  display: CaptureDisplayLike;
  image: NativeImageLike;
  /** Bounded JPEG preview (display DIP size) handed to the overlay. */
  preview: string;
  takenAt: number;
}

export interface CaptureFrameStoreOptions {
  now?: () => number;
  ttlMs?: number;
  limit?: number;
}

/**
 * Frozen frames (plan 80, D7): memory only, one per display, small LRU, short
 * TTL. Adjust re-crops from here without a second screenshot; nothing is ever
 * logged or persisted.
 */
export class CaptureFrameStore {
  private readonly frames = new Map<number, CaptureFrame>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly limit: number;

  constructor(options: CaptureFrameStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CAPTURE_FRAME_TTL_MS;
    this.limit = options.limit ?? CAPTURE_FRAME_LIMIT;
  }

  public put(frame: CaptureFrame): void {
    this.frames.delete(frame.display.id);
    this.frames.set(frame.display.id, frame);
    this.prune();
  }

  public get(displayId: number): CaptureFrame | null {
    const frame = this.frames.get(displayId);
    if (!frame) {
      return null;
    }
    if (this.now() - frame.takenAt > this.ttlMs) {
      this.frames.delete(displayId);
      return null;
    }
    this.frames.delete(displayId);
    this.frames.set(displayId, frame);
    return frame;
  }

  public clear(): void {
    this.frames.clear();
  }

  public size(): number {
    return this.frames.size;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [displayId, frame] of this.frames) {
      if (frame.takenAt < cutoff) {
        this.frames.delete(displayId);
      }
    }
    while (this.frames.size > this.limit) {
      const oldest = this.frames.keys().next();
      if (oldest.done) {
        break;
      }
      this.frames.delete(oldest.value);
    }
  }
}
