import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MIN_REGION_DIP,
  classifyGesture,
  clampRect,
  displayAtPoint,
  hitTestWindows,
  isOwnWindowTitle,
  normalizeRect,
  regionLabel,
  resolveAutoWindow,
  scaleToFit,
  selectionFromGesture,
  toDisplayLocal,
  toPixels,
  windowLabel,
  type CaptureDisplayLike,
  type CaptureRect,
  type CaptureWindowRect,
} from '@shared/capture';

const displays: CaptureDisplayLike[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 },
  { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, scaleFactor: 1 },
];

const browser: CaptureWindowRect = { title: 'GitHub — Firefox', app: 'firefox', rect: { x: 100, y: 80, width: 900, height: 600 } };
const editor: CaptureWindowRect = { title: 'main.ts — Code', app: 'code', rect: { x: 40, y: 40, width: 1400, height: 900 } };

describe('capture rect math', () => {
  it('normalizes a reversed drag into a positive rect', () => {
    expect(normalizeRect({ x: 120, y: 90 }, { x: 20, y: 30 })).toEqual({ x: 20, y: 30, width: 100, height: 60 });
  });

  it('clamps a rect into the display bounds', () => {
    const clamped = clampRect({ x: -20, y: 1000, width: 400, height: 200 }, { x: 0, y: 0, width: 1920, height: 1080 });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(880);
    expect(clamped.width).toBe(400);
    expect(clamped.height).toBe(200);
  });

  it('scales DIP to device pixels and clamps to the pixel surface', () => {
    expect(toPixels({ x: 10, y: 10, width: 100, height: 50 }, 2, { width: 3840, height: 2160 })).toEqual({
      x: 20,
      y: 20,
      width: 200,
      height: 100,
    });
    const edge = toPixels({ x: 950, y: 500, width: 200, height: 200 }, 2, { width: 1920, height: 1080 });
    expect(edge.x + edge.width).toBeLessThanOrEqual(1920);
    expect(edge.y + edge.height).toBeLessThanOrEqual(1080);
  });

  it('caps oversized images on the long edge without upscaling', () => {
    expect(scaleToFit({ width: 3840, height: 2160 }, 1600)).toEqual({ width: 1600, height: 900 });
    expect(scaleToFit({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('translates a global rect into display-local coordinates', () => {
    expect(toDisplayLocal({ x: 2000, y: 50, width: 100, height: 100 }, displays[1])).toEqual({
      x: 80,
      y: 50,
      width: 100,
      height: 100,
    });
  });
});

describe('display + window resolution', () => {
  it('picks the display under the point and falls back to the first', () => {
    expect(displayAtPoint(displays, { x: 2000, y: 10 })?.id).toBe(2);
    expect(displayAtPoint(displays, { x: 5000, y: 10 })?.id).toBe(1);
    expect(displayAtPoint([], { x: 0, y: 0 })).toBeNull();
  });

  it('hit-tests top-first (the first containing window wins)', () => {
    expect(hitTestWindows([browser, editor], { x: 200, y: 200 })?.title).toBe(browser.title);
    expect(hitTestWindows([browser, editor], { x: 50, y: 50 })?.title).toBe(editor.title);
    expect(hitTestWindows([browser, editor], { x: 1900, y: 1000 })).toBeNull();
  });

  it('treats our own surfaces as untouchable targets', () => {
    expect(isOwnWindowTitle('Desktop Assistant', ['Desktop Assistant'])).toBe(true);
    expect(isOwnWindowTitle('Desktop Assistant — Capture', ['Desktop Assistant'])).toBe(true);
    expect(isOwnWindowTitle('Settings', ['Desktop Assistant'])).toBe(false);
  });

  it('walks the ladder: pointer window, then behind, then nothing', () => {
    expect(
      resolveAutoWindow({ windows: [browser, editor], point: { x: 200, y: 200 }, ownTitles: [] })?.title
    ).toBe(browser.title);
    expect(
      resolveAutoWindow({ windows: [browser, editor], point: { x: 1900, y: 1000 }, ownTitles: [] })?.title
    ).toBe(browser.title);
    expect(
      resolveAutoWindow({
        windows: [
          { title: 'Desktop Assistant', rect: { x: 0, y: 0, width: 100, height: 100 } },
          editor,
        ],
        point: { x: 10, y: 10 },
        ownTitles: ['Desktop Assistant'],
      })?.title
    ).toBe(editor.title);
    expect(resolveAutoWindow({ windows: [], point: { x: 0, y: 0 }, ownTitles: [] })).toBeNull();
  });
});

describe('capture gesture classification', () => {
  it('treats a still, quick press as a click', () => {
    expect(classifyGesture({ x: 10, y: 10 }, { x: 12, y: 11 }, 80)).toBe('click');
  });

  it('treats travel or a long press as a drag', () => {
    expect(classifyGesture({ x: 10, y: 10 }, { x: 30, y: 10 }, 80)).toBe('drag');
    expect(classifyGesture({ x: 10, y: 10 }, { x: 11, y: 10 }, 900)).toBe('drag');
  });

  it('resolves a click to the hovered window, a drag to the region, and a bare click to the display', () => {
    const hovered = browser;
    expect(
      selectionFromGesture({ start: { x: 200, y: 200 }, end: { x: 201, y: 200 }, durationMs: 60, hovered })
    ).toEqual({ kind: 'window', window: browser });
    const drag = selectionFromGesture({
      start: { x: 100, y: 100 },
      end: { x: 400, y: 300 },
      durationMs: 400,
      hovered: null,
    });
    expect(drag).toEqual({ kind: 'region', rect: { x: 100, y: 100, width: 300, height: 200 } });
    expect(
      selectionFromGesture({ start: { x: 5, y: 5 }, end: { x: 6, y: 5 }, durationMs: 40, hovered: null })
    ).toEqual({ kind: 'display' });
  });

  it('rejects a drag smaller than the minimum region as a click', () => {
    const rect: CaptureRect = { x: 10, y: 10, width: CAPTURE_MIN_REGION_DIP - 1, height: 100 };
    const selection = selectionFromGesture({
      start: { x: rect.x, y: rect.y },
      end: { x: rect.x + rect.width, y: rect.y + rect.height },
      durationMs: 400,
      hovered: browser,
    });
    expect(selection.kind).toBe('window');
  });
});

describe('capture labels', () => {
  it('names a window by app and title, and a region by size', () => {
    expect(windowLabel(browser)).toBe('firefox — GitHub — Firefox');
    expect(windowLabel({ title: 'Untitled' })).toBe('Untitled');
    expect(regionLabel({ x: 0, y: 0, width: 820.4, height: 460.6 })).toBe('Region 820×461');
  });
});
