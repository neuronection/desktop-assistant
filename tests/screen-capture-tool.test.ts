import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screenCaptureTool } from '@main/ai/tools/native/screen-capture';

type ImageCalls = { crops: Rect[]; resizes: { width?: number }[] };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fakeImage(calls: ImageCalls, width = 2000, height = 1600) {
  const self = {
    getSize: () => ({ width, height }),
    toJPEG: vi.fn(() => (width > 0 && height > 0 ? Buffer.from('fake-jpeg') : Buffer.alloc(0))),
    crop: vi.fn((rect: Rect) => {
      calls.crops.push(rect);
      return fakeImage(calls, rect.width, rect.height);
    }),
    resize: vi.fn((opts: { width?: number }) => {
      calls.resizes.push(opts);
      return self;
    }),
  };
  return self;
}

const electronState: {
  sources: unknown[];
  display?: Record<string, unknown>;
} = { sources: [] };

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () =>
      electronState.display ?? { id: 1, size: { width: 1000, height: 800 }, scaleFactor: 2 },
  },
  desktopCapturer: {
    getSources: vi.fn(async (options: { types: string[]; thumbnailSize?: unknown }) => {
      const types = Array.isArray(options.types) ? options.types : [options.types];
      return electronState.sources.filter((source: { type: string }) => types.includes(source.type));
    }),
  },
}));

import { desktopCapturer } from 'electron';

beforeEach(() => {
  vi.clearAllMocks();
  electronState.sources = [];
});

describe('screen_capture modes', () => {
  it('captures the full display at downscaled size when no args are given', async () => {
    const calls: ImageCalls = { crops: [], resizes: [] };
    electronState.sources = [{ type: 'screen', display_id: '1', thumbnail: fakeImage(calls) }];

    const result = await screenCaptureTool.exec({}, {});
    expect(Array.isArray(result)).toBe(true);
    const blocks = result as { type: string }[];
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('image');
    expect(calls.crops).toHaveLength(0);
    const getSources = desktopCapturer.getSources as unknown as ReturnType<typeof vi.fn>;
    expect(getSources.mock.calls[0][0].thumbnailSize).toEqual({ width: 1280, height: 1024 });
  });

  it('captures at full pixel size and crops the scaled region', async () => {
    const calls: ImageCalls = { crops: [], resizes: [] };
    electronState.sources = [{ type: 'screen', display_id: '1', thumbnail: fakeImage(calls) }];

    const result = (await screenCaptureTool.exec(
      { region: { x: 10, y: 20, width: 100, height: 50 } },
      {}
    )) as { type: string }[];
    expect(calls.crops).toEqual([{ x: 20, y: 40, width: 200, height: 100 }]);
    expect(calls.resizes).toHaveLength(0);
    expect(result[0].type).toBe('text');
    expect((result[0] as { text: string }).text).toContain('region (100x50)');
  });

  it('clamps oversized regions and downscales wide crops', async () => {
    const calls: ImageCalls = { crops: [], resizes: [] };
    electronState.sources = [{ type: 'screen', display_id: '1', thumbnail: fakeImage(calls) }];

    await screenCaptureTool.exec({ region: { x: 500, y: 700, width: 900, height: 900 } }, {});
    expect(calls.crops[0]).toEqual({ x: 1000, y: 1400, width: 1000, height: 200 });
    expect(calls.resizes).toHaveLength(0);

    await screenCaptureTool.exec({ region: { x: 0, y: 0, width: 900, height: 400 } }, {});
    expect(calls.crops[1]).toEqual({ x: 0, y: 0, width: 1800, height: 800 });
    expect(calls.resizes).toEqual([{ width: 1280 }]);
  });

  it('captures a matching window and reports misses gracefully', async () => {
    const calls: ImageCalls = { crops: [], resizes: [] };
    const thumbnail = fakeImage(calls, 1280, 800);
    electronState.sources = [
      { type: 'window', name: 'Firefox — GitHub', thumbnail },
      { type: 'window', name: 'Alacritty', thumbnail: fakeImage(calls) },
    ];

    const result = (await screenCaptureTool.exec({ windowName: 'git' }, {})) as { type: string }[];
    expect((result[0] as { text: string }).text).toContain("window 'Firefox — GitHub'");
    expect(thumbnail.toJPEG).toHaveBeenCalled();

    const miss = await screenCaptureTool.exec({ windowName: 'nonexistent' }, {});
    expect(miss).toBe("Error: no window matching 'nonexistent' was found. Available windows: Firefox — GitHub, Alacritty.");

    electronState.sources = [{ type: 'window', name: 'Broken', thumbnail: fakeImage([], 0, 0) }];
    const empty = await screenCaptureTool.exec({ windowName: 'broken' }, {});
    expect(empty).toBe('Error: window capture is not available for that window on this system.');
  });

  it('rejects region and windowName together', () => {
    const parsed = screenCaptureTool.schema.safeParse({
      region: { x: 0, y: 0, width: 10, height: 10 },
      windowName: 'x',
    });
    expect(parsed.success).toBe(false);
  });
});
