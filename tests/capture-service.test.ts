import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplayLike } from '@shared/capture';
import { CaptureService } from '@main/services/capture/CaptureService';
import { CaptureSources, type DesktopSourceLike, type NativeImageLike } from '@main/services/capture/sources';
import type { CaptureGeometryProvider } from '@main/services/capture/geometry';
import type { EncodedImage } from '@main/services/capture/region';

const displays: CaptureDisplayLike[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 2 },
];

function fakeImage(width = 2000, height = 1600): NativeImageLike {
  const self: NativeImageLike = {
    getSize: () => ({ width, height }),
    toJPEG: () => Buffer.from(`jpeg:${width}x${height}`),
    toDataURL: () => `data:image/png;base64,icon-${width}`,
    crop: () => self,
    resize: (options: { width?: number }) =>
      options.width ? fakeImage(options.width, Math.round((height / width) * options.width)) : self,
  };
  return self;
}

interface Harness {
  service: CaptureService;
  reveal: ReturnType<typeof vi.fn>;
  regionCapture: ReturnType<typeof vi.fn>;
  regionAvailable: ReturnType<typeof vi.fn>;
}

function harness(options: {
  windows?: Array<{ title: string; app?: string; rect: { x: number; y: number; width: number; height: number } }> | null;
  cursor?: { x: number; y: number };
  sources?: DesktopSourceLike[];
  regionAvailable?: boolean;
  regionImage?: EncodedImage | null;
} = {}): Harness {
  const list: DesktopSourceLike[] =
    options.sources ??
    [
      { id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: fakeImage(2000, 1600) },
      { id: 'window:0x1:0', name: 'GitHub — Firefox', display_id: '1', thumbnail: fakeImage(1800, 1200), appIcon: fakeImage(32, 32) },
    ];
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
  const reveal = vi.fn();
  const regionCapture = vi.fn(async () =>
    options.regionImage !== undefined ? options.regionImage : { jpeg: Buffer.from('region'), width: 640, height: 480 }
  );
  const regionAvailable = vi.fn(async () => options.regionAvailable !== false);
  const service = new CaptureService({
    sources: new CaptureSources({
      getSources: async (request) => {
        const wanted = new Set(request.types.map((type) => (type === 'screen' ? 'screen' : 'window')));
        return list.filter((source) => wanted.has(source.id.startsWith('screen:') ? 'screen' : 'window'));
      },
    }),
    geometry,
    region: { available: regionAvailable, capture: regionCapture },
    displays: () => displays,
    cursorPoint: () => options.cursor ?? { x: 210, y: 210 },
    ownWindowTitles: () => ['Desktop Assistant'],
    hideSurfaces: async () => undefined,
    revealSurfaces: reveal,
    platform: 'linux',
  });
  return { service, reveal, regionCapture, regionAvailable };
}

describe('CaptureService', () => {
  it('captures the window under the pointer', async () => {
    const { service, reveal } = harness();
    const outcome = await service.begin({ intent: 'auto' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.meta).toMatchObject({ kind: 'window', label: 'firefox — GitHub — Firefox' });
      expect(outcome.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    }
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('falls back to the display when nothing resolves (no custom overlay exists)', async () => {
    const { service } = harness({ windows: null });
    const outcome = await service.begin({ intent: 'auto' });
    expect(outcome.ok && outcome.meta.kind).toBe('display');
  });

  it('captures an explicitly chosen source row', async () => {
    const { service } = harness();
    const outcome = await service.begin({ intent: 'source', sourceId: 'window:0x1:0' });
    expect(outcome.ok && outcome.meta.kind).toBe('window');
  });

  it('runs the OS region tool and reports a cancel honestly', async () => {
    const ok = harness();
    const captured = await ok.service.begin({ intent: 'region' });
    expect(ok.regionCapture).toHaveBeenCalledTimes(1);
    expect(captured.ok && captured.meta).toMatchObject({ kind: 'region', label: 'Region 640×480' });

    const cancelled = harness({ regionImage: null });
    expect(await cancelled.service.begin({ intent: 'region' })).toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('says so when the machine has no native region tool', async () => {
    const { service, regionCapture } = harness({ regionAvailable: false });
    const outcome = await service.begin({ intent: 'region' });
    expect(outcome).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(regionCapture).not.toHaveBeenCalled();
  });

  it('lists screens and windows, hiding our own windows', async () => {
    const { service } = harness({
      sources: [
        { id: 'screen:1:0', name: 'Screen 1', display_id: '1', thumbnail: fakeImage() },
        { id: 'window:0x1:0', name: 'GitHub — Firefox', thumbnail: fakeImage(1800, 1200), appIcon: fakeImage(32, 32) },
        { id: 'window:0x2:0', name: 'Desktop Assistant — Capture', thumbnail: fakeImage(800, 600) },
      ],
    });
    const list = await service.listSources();
    expect(list.screens.map((row) => row.name)).toEqual(['Screen 1']);
    expect(list.windows.map((row) => row.name)).toEqual(['GitHub — Firefox']);
    expect(list.windows[0]?.icon).toBe('data:image/png;base64,icon-32');
    expect(list.region).toBe(true);
  });

  it('captures a named window for the agent tool', async () => {
    const { service } = harness();
    const outcome = await service.captureNamedWindow('GitHub — Firefox');
    expect(outcome.ok && outcome.meta.kind).toBe('window');
    expect(await service.captureNamedWindow('Nothing Here')).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('shares one running session instead of running twice', async () => {
    const { service, regionCapture } = harness();
    const [a, b] = await Promise.all([
      service.begin({ intent: 'region' }),
      service.begin({ intent: 'display' }),
    ]);
    expect(a).toBe(b);
    expect(regionCapture).toHaveBeenCalledTimes(1);
  });
});
