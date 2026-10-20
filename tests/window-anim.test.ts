import { describe, it, expect } from 'vitest';
import { easeStep, resizeTargetChanged } from '@main/windowAnim';

describe('easeStep', () => {
  it('moves toward the target without overshoot', () => {
    const steps: number[] = [];
    let current = 76;
    while (current !== 550 && steps.length < 100) {
      current = easeStep(current, 550);
      steps.push(current);
    }
    expect(steps.length).toBeLessThan(100);
    expect(Math.min(...steps)).toBeGreaterThan(76);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(current).toBe(550);
  });

  it('snaps to the target within the epsilon', () => {
    expect(easeStep(549.5, 550)).toBe(550);
    expect(easeStep(76, 76)).toBe(76);
  });

  it('eases both directions', () => {
    expect(easeStep(550, 76)).toBeLessThan(550);
    expect(easeStep(550, 76)).toBeGreaterThan(76);
  });

  it('honors a custom factor', () => {
    expect(easeStep(100, 200, 0.5)).toBe(150);
  });
});

describe('resizeTargetChanged', () => {
  it('queues a new target when the window is idle at a different size', () => {
    expect(resizeTargetChanged({ width: 650, height: 98 }, { width: 650, height: 121 }, false)).toBe(true);
  });

  it('drops a true no-op when no animation is running', () => {
    expect(resizeTargetChanged({ width: 650, height: 121 }, { width: 650, height: 121 }, false)).toBe(false);
  });

  it('never drops a target while an eased resize is in flight (reload race)', () => {
    expect(resizeTargetChanged({ width: 650, height: 121 }, { width: 650, height: 121 }, true)).toBe(true);
  });
});
