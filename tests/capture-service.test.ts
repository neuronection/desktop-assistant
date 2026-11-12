import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplayLike, CaptureOverlaySession, CaptureRect } from '@shared/capture';
import { CaptureService } from '@main/services/capture/CaptureService';
import { CaptureFrameStore } from '@main/services/capture/frames';
import { CaptureSources, type DesktopSourceLike, type NativeImageLike } from '@main/services/capture/sources';
import type { CaptureGeometryProvider } from '@main/services/capture/geometry';

const displays: CaptureDisplayLike[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 2 },
];

function fakeImage(
  width = 2000,
  height = 1600,
  crops: CaptureRect[] = [],
  resizeWidths: number[] = []
): NativeImageLike {
  const self: NativeImageLike = {
    getSize: () => ({ width, height }),
    toJPEG: () => Buffer.from(`jpeg:${width}x${height}`),
    crop: (rect: CaptureRect) => {
      crops.push(rect);
      return fakeImage(Math.max(1, rect.width), Math.max(1, rect.height), crops, resizeWidths);
    },
    resize: (options: { width?: number }) => {
      if (options.width) {
        resizeWidths.push(options.width);
        return fakeImage(Math.round(options.width), Math.round((height / width) * options.width), crops, resizeWidths);
      }
      return self;
    },
  };
  return self;
}

interface Harness {
  service: CaptureService;
  overlayOpen: ReturnType<typeof vi.fn>;
  crops: CaptureRect[];
  reveal: ReturnType<typeof vi.fn>;
  sources: CaptureSources;
  frames: CaptureFrameStore;
}

function harness(options: {
  windows?: Array<{ title: string; app?: string; rect: CaptureRect }> | null;
  selection?: unknown;
  cursor?: { x: number; y: number };
  wayland?: boolean;
  sources?: DesktopSourceLike[];
  ownTitles?: string[];
} = {}): Harness {
  const crops: CaptureRect[] = [];
  const screenImage = fakeImage(2000, 1600, crops);
  const list: DesktopSourceLike[] =
    options.sources ??
    [
      { id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: screenImage },
      { id: 'window:0x1:0', name: 'GitHub — Firefox', thumbnail: fakeImage(1800, 1200) },
    ];
  const sources = new CaptureSources({
    getSources: async () => list,
  });
  const geometry: CaptureGeometryProvider = {
    kind: 'x11',
    scaleMode: 'global',
    windows: async () =>
      options.windows === undefined
        ? [
            { title: 'Desktop Assistant', app: 'electron', rect: { x: 0, y: 0, width: 600, height: 400 } },
            { title: 'GitHub — Firefox', app: 'firefox', rect: { x: 200, y: 160, width: 1800, height: 1200 } },
          ]
        : options.windows,
  };
  const frames = new CaptureFrameStore({ now: () => 1_000, ttlMs: 30_000, limit: 2 });
  const overlayOpen = vi.fn(async (_session: CaptureOverlaySession) => ({
    selection: (options.selection ?? null) as never,
  }));
  const reveal = vi.fn();
  const service = new CaptureService({
    sources,
    geometry,
    frames,
    overlay: { open: overlayOpen, close: () => undefined },
    displays: () => displays,
    cursorPoint: () => options.cursor ?? { x: 210, y: 210 },
    ownWindowTitles: () => options.ownTitles ?? ['Desktop Assistant'],
    hideSurfaces: async () => undefined,
    revealSurfaces: reveal,
    platform: 'linux',
    isWayland: () => options.wayland === true,
    now: () => 1_000,
  });
  return { service, overlayOpen, crops, reveal, sources, frames };
}

function jpegPayload(outcome: unknown): string {
  const value = outcome as { dataUrl?: string };
  expect(value.dataUrl?.startsWith('data:image/jpeg;base64,')).toBe(true);
  return value.dataUrl ?? '';
}

describe('CaptureService.auto', () => {
  it('captures the window under the pointer and names it', async () => {
    const { service } = harness();
    const outcome = await service.begin({ intent: 'auto' });
    expect(outcome.ok).toBe(true);
    jpegPayload(outcome);
    if (outcome.ok) {
      expect(outcome.meta).toMatchObject({ kind: 'window', label: 'firefox — GitHub — Firefox', displayId: 1 });
      expect(outcome.meta.width).toBe(1600);
    }
  });

  it('falls through to the window behind ours when the pointer is over our own surface', async () => {
    const { service } = harness({ cursor: { x: 20, y: 20 } });
    const outcome = await service.begin({ intent: 'auto' });
    expect(outcome.ok && outcome.meta.kind).toBe('window');
    expect(outcome.ok && outcome.meta.label).toBe('firefox — GitHub — Firefox');
  });

  it('captures the whole display when no window can be resolved', async () => {
    const { service } = harness({ windows: null });
    const outcome = await service.begin({ intent: 'auto' });
    expect(outcome.ok && outcome.meta).toMatchObject({ kind: 'display', label: 'Full display' });
  });

  it('honours the display intent with no window lookup', async () => {
    const { service } = harness();
    const outcome = await service.begin({ intent: 'display' });
    expect(outcome.ok && outcome.meta.kind).toBe('display');
  });
});

describe('CaptureService.overlay', () => {
  it('crops the frozen frame at the display scale factor', async () => {
    const { service, overlayOpen, crops } = harness({
      selection: { kind: 'region', rect: { x: 10, y: 20, width: 100, height: 50 } },
    });
    const outcome = await service.begin({ intent: 'overlay' });
    expect(overlayOpen).toHaveBeenCalledTimes(1);
    expect(crops.at(-1)).toEqual({ x: 20, y: 40, width: 200, height: 100 });
    expect(outcome.ok && outcome.meta).toMatchObject({
      kind: 'region',
      label: 'Region 100×50',
      rect: { x: 10, y: 20, width: 100, height: 50 },
    });
  });

  it('arms the overlay with the ladder target for the pointer', async () => {
    const { service, overlayOpen } = harness({ selection: null });
    await service.begin({ intent: 'overlay' });
    const session = overlayOpen.mock.calls[0]?.[0] as CaptureOverlaySession;
    expect(session.display).toMatchObject({ id: 1, width: 1000, height: 800, scaleFactor: 2 });
    expect(session.armed?.title).toBe('GitHub — Firefox');
    expect(session.preview.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('reports a cancel without capturing anything', async () => {
    const { service } = harness({ selection: null });
    const outcome = await service.begin({ intent: 'overlay' });
    expect(outcome).toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('captures a chosen window from its source, cropping the frame when the source is gone', async () => {
    const { service } = harness({
      selection: { kind: 'window', window: { title: 'GitHub — Firefox', rect: { x: 100, y: 80, width: 900, height: 600 } } },
    });
    const first = await service.begin({ intent: 'overlay' });
    expect(first.ok && first.meta.kind).toBe('window');

    const fallback = harness({
      selection: { kind: 'window', window: { title: 'Gone — Window', rect: { x: 10, y: 10, width: 100, height: 100 } } },
    });
    const second = await fallback.service.begin({ intent: 'overlay' });
    expect(second.ok && second.meta.kind).toBe('region');
    expect(fallback.crops.at(-1)).toEqual({ x: 20, y: 20, width: 200, height: 200 });
  });

  it('reuses a warm frame for Adjust and re-arms the previous region', async () => {
    const selection = { kind: 'region', rect: { x: 10, y: 20, width: 100, height: 50 } };
    const first = harness({ selection });
    await first.service.begin({ intent: 'overlay' });
    expect(first.frames.size()).toBe(1);

    const again = await first.service.begin({
      intent: 'overlay',
      initial: { displayId: 1, rect: { x: 10, y: 20, width: 100, height: 50 } },
    });
    expect(again.ok && again.meta.kind).toBe('region');
  });
});

describe('CaptureService platform paths', () => {
  it('uses the portal pick on Wayland instead of the overlay', async () => {
    const { service, overlayOpen } = harness({
      wayland: true,
      sources: [
        { id: 'window:portal:0', name: 'GitHub — Firefox', thumbnail: fakeImage(1600, 1000) },
      ],
    });
    const outcome = await service.begin({ intent: 'overlay' });
    expect(overlayOpen).not.toHaveBeenCalled();
    expect(outcome.ok && outcome.meta.label).toBe('GitHub — Firefox');
  });

  it('reveals the surfaces exactly once per session, even when it fails', async () => {
    const { service, reveal } = harness({ selection: null });
    await service.begin({ intent: 'overlay' });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('shares one running session instead of stacking overlays', async () => {
    const { service, overlayOpen } = harness({
      selection: { kind: 'region', rect: { x: 0, y: 0, width: 100, height: 100 } },
    });
    const [a, b] = await Promise.all([service.begin({ intent: 'overlay' }), service.begin({ intent: 'auto' })]);
    expect(overlayOpen).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});
