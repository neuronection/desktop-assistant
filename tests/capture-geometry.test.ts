import { describe, expect, it, vi } from 'vitest';
import type { CaptureDisplayLike } from '@shared/capture';
import {
  applyStackingOrder,
  buildWindowsWindowScript,
  createWindowGeometryProvider,
  nativeRectsToDip,
  parseStackingOrder,
  parseWindowsWindowList,
  parseWmctrlGeometry,
} from '@main/services/capture/geometry';

const WMCTRL = [
  '0x03a00007  0  1920  40    1280  1024 host nautilus.Nautilus  Documents',
  '0x05200003  0  100   80    900   600  host firefox.Firefox    GitHub — Firefox',
  '0x06000011  0  0     0     3840  2160 host desktop.Desktop     x',
  '0x07000019  -1 0     0     1920  1080 host plank.Plank        x',
  'malformed row',
  '',
].join('\n');

const displays: CaptureDisplayLike[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 },
];

describe('x11 parsing', () => {
  it('parses wmctrl geometry rows and skips shells and junk', () => {
    const rows = parseWmctrlGeometry(WMCTRL);
    expect(rows.map((row) => row.title)).toEqual(['Documents', 'GitHub — Firefox']);
    expect(rows[1]).toMatchObject({ id: '0x05200003', app: 'firefox', rect: { x: 100, y: 80, width: 900, height: 600 } });
  });

  it('parses and applies the stacking list top-first', () => {
    const rows = parseWmctrlGeometry(WMCTRL);
    const stacking = parseStackingOrder('_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x03a00007, 0x05200003');
    expect(stacking).toEqual(['0x03a00007', '0x05200003']);
    const ordered = applyStackingOrder(rows, stacking);
    expect(ordered.map((row) => row.id)).toEqual(['0x05200003', '0x03a00007']);
  });

  it('keeps the parsed order when no stacking list is available', () => {
    const rows = parseWmctrlGeometry(WMCTRL);
    expect(applyStackingOrder(rows, []).map((row) => row.id)).toEqual(['0x03a00007', '0x05200003']);
    expect(parseStackingOrder('no such property')).toEqual([]);
  });

  it('reads windows through the injected exec, degrading to null', async () => {
    const exec = vi.fn(async (file: string) => {
      if (file === 'wmctrl') {
        return WMCTRL;
      }
      return '_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x03a00007, 0x05200003';
    });
    const provider = createWindowGeometryProvider({ platform: 'linux', exec });
    const windows = await provider.windows();
    expect(provider.kind).toBe('x11');
    expect(windows?.map((window) => window.title)).toEqual(['GitHub — Firefox', 'Documents']);

    const missing = createWindowGeometryProvider({
      platform: 'linux',
      exec: vi.fn(async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }),
    });
    expect(await missing.windows()).toBeNull();
  });
});

describe('win32 parsing', () => {
  const script = buildWindowsWindowScript();

  it('enumerates top-level windows in z-order with rects', () => {
    expect(script).toContain('EnumWindows');
    expect(script).toContain('GetWindowRect');
    expect(script).toContain('IsWindowVisible');
  });

  it('parses the pipe rows, dropping untitled and degenerate windows', () => {
    const rows = parseWindowsWindowList(
      ['100|80|900|600|GitHub — Firefox', '0|0|0|0|Zero', '|missing', '40|40|1400|900|main.ts — Code'].join('\n')
    );
    expect(rows.map((row) => row.title)).toEqual(['GitHub — Firefox', 'main.ts — Code']);
  });

  it('runs the script through the injected exec', async () => {
    const exec = vi.fn(async () => '100|80|900|600|GitHub — Firefox');
    const provider = createWindowGeometryProvider({ platform: 'win32', exec });
    expect(provider.scaleMode).toBe('per-display');
    expect((await provider.windows())?.map((window) => window.title)).toEqual(['GitHub — Firefox']);
  });
});

describe('macOS and DIP conversion', () => {
  it('reports nothing on macOS (no supported C surface from Electron)', async () => {
    const provider = createWindowGeometryProvider({ platform: 'darwin' });
    expect(provider.kind).toBe('none');
    expect(await provider.windows()).toBeNull();
  });

  it('scales native pixels with the global model (X11)', () => {
    const dip = nativeRectsToDip(
      [{ title: 'Firefox', rect: { x: 200, y: 160, width: 1800, height: 1200 } }],
      { scaleMode: 'global', reference: displays[0] }
    );
    expect(dip).toEqual([{ title: 'Firefox', app: undefined, rect: { x: 100, y: 80, width: 900, height: 600 } }]);
  });

  it('offsets per-monitor DPI (Windows) against the reference display origin', () => {
    const secondary: CaptureDisplayLike = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1.5,
    };
    const dip = nativeRectsToDip([{ title: 'Lodpi', rect: { x: 3000, y: 300, width: 600, height: 600 } }], {
      scaleMode: 'per-display',
      reference: secondary,
    });
    expect(dip[0]?.rect).toMatchObject({ x: 2000, y: 200, width: 400, height: 400 });
  });
});
