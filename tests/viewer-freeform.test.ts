import { describe, expect, it } from 'vitest';
import {
  appendPolygonPoint,
  isUsablePolygon,
  polygonArea,
  polygonPercentPoints,
  polygonWithinCrop,
  VIEWER_MIN_POLYGON_AREA,
} from '@shared/viewer';

const square = [
  { x: 40, y: 40 },
  { x: 240, y: 40 },
  { x: 240, y: 240 },
  { x: 40, y: 240 },
];

describe('freeform polygon math', () => {
  it('measures the area of a closed shape (shoelace)', () => {
    expect(polygonArea(square)).toBe(40_000);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(0);
  });

  it('rejects stray clicks and accepts a real lasso', () => {
    expect(isUsablePolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }])).toBe(false);
    expect(isUsablePolygon(square)).toBe(true);
    expect(polygonArea(square)).toBeGreaterThan(VIEWER_MIN_POLYGON_AREA);
  });

  it('does not record pointer jitter as new points', () => {
    const points = [{ x: 10, y: 10 }];
    expect(appendPolygonPoint(points, { x: 12, y: 11 })).toHaveLength(1);
    expect(appendPolygonPoint(points, { x: 30, y: 10 })).toHaveLength(2);
  });

  it('renders percentage points so the overlay survives any fit scale', () => {
    expect(polygonPercentPoints([{ x: 0, y: 0 }, { x: 400, y: 200 }], { width: 800, height: 400 })).toBe(
      '0.00,0.00 50.00,50.00'
    );
  });

  it('moves a lasso into crop space and drops what fell outside', () => {
    const crop = { x: 50, y: 50, width: 200, height: 200 };
    expect(polygonWithinCrop([{ x: 60, y: 60 }, { x: 250, y: 60 }, { x: 999, y: 999 }], crop)).toEqual([
      { x: 10, y: 10 },
      { x: 200, y: 10 },
    ]);
  });
});
