import { describe, it, expect } from 'vitest';
import { validateDimensions, computeCornerResizeBounds, computeMovedPosition, WINDOW_SIZE } from '@shared/constants/window';

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const START = { x: 760, y: 600, width: 400, height: 300 };

describe('resize request clamping', () => {
  it('grows freely up to the configured maximum — never down to the current size', () => {
    const small = validateDimensions(650, 76);
    expect(small.adjustedWidth).toBe(650);
    expect(small.adjustedHeight).toBe(76);

    const grown = validateDimensions(650, 420);
    expect(grown.adjustedWidth).toBe(650);
    expect(grown.adjustedHeight).toBe(420);
  });

  it('clamps below minimum and above maximum bounds', () => {
    expect(validateDimensions(10, 10).adjustedWidth).toBe(WINDOW_SIZE.MIN_WIDTH);
    expect(validateDimensions(10, 10).adjustedHeight).toBe(WINDOW_SIZE.MIN_HEIGHT);
    expect(validateDimensions(99_999, 99_999).adjustedWidth).toBe(WINDOW_SIZE.MAX_WIDTH);
    expect(validateDimensions(99_999, 99_999).adjustedHeight).toBe(WINDOW_SIZE.MAX_HEIGHT);
  });
});

describe('corner resize bounds', () => {
  it('bottom-right grows toward the bottom-right and keeps the origin', () => {
    const next = computeCornerResizeBounds(START, 'bottom-right', 120, 80, WORK_AREA);
    expect(next).toEqual({ x: 760, y: 600, width: 520, height: 380 });
  });

  it('bottom-left grows leftward and anchors the right edge', () => {
    const next = computeCornerResizeBounds(START, 'bottom-left', -150, 40, WORK_AREA);
    expect(next).toEqual({ x: 760 - 150, y: 600, width: 550, height: 340 });
  });

  it('bottom-left clamps at the minimum width and moves the origin to keep the right edge', () => {
    const next = computeCornerResizeBounds(START, 'bottom-left', 5_000, 0, WORK_AREA);
    expect(next.width).toBe(WINDOW_SIZE.MIN_WIDTH);
    expect(next.x).toBe(START.x + START.width - WINDOW_SIZE.MIN_WIDTH);
  });

  it('bottom-left never grows past the work area left edge', () => {
    const nearEdge = { ...START, x: 100, width: 300 };
    const next = computeCornerResizeBounds(nearEdge, 'bottom-left', -5_000, 0, WORK_AREA);
    expect(next.x).toBeGreaterThanOrEqual(WORK_AREA.x);
    expect(next.x + next.width).toBe(nearEdge.x + nearEdge.width);
  });

  it('bottom-right never grows past the work area right edge', () => {
    const next = computeCornerResizeBounds(START, 'bottom-right', 99_999, 0, WORK_AREA);
    expect(next.x + next.width).toBeLessThanOrEqual(WORK_AREA.x + WORK_AREA.width);
  });

  it('height clamps to the work area bottom for both corners', () => {
    for (const corner of ['bottom-left', 'bottom-right'] as const) {
      const next = computeCornerResizeBounds(START, corner, 0, 99_999, WORK_AREA);
      expect(next.y + next.height).toBeLessThanOrEqual(WORK_AREA.y + WORK_AREA.height);
    }
  });
});

describe('header drag position clamping', () => {
  const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
  const WIDTH = 900;
  const HEIGHT = 600;

  it('moves by the pointer deltas inside the work area', () => {
    const next = computeMovedPosition(500, 200, 120, -60, WIDTH, HEIGHT, WORK);
    expect(next).toEqual({ x: 620, y: 140 });
  });

  it('keeps part of the window reachable on every edge', () => {
    const farRight = computeMovedPosition(100, 100, 99_999, 0, WIDTH, HEIGHT, WORK);
    expect(farRight.x).toBe(WORK.width - 80);
    const farLeft = computeMovedPosition(100, 100, -99_999, 0, WIDTH, HEIGHT, WORK);
    expect(farLeft.x).toBe(WORK.x - WIDTH + 80);
    const above = computeMovedPosition(100, 100, 0, -99_999, WIDTH, HEIGHT, WORK);
    expect(above.y).toBe(WORK.y);
    const below = computeMovedPosition(100, 100, 0, 99_999, WIDTH, HEIGHT, WORK);
    expect(below.y).toBe(WORK.height - 80);
  });
});
