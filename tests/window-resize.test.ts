import { describe, it, expect } from 'vitest';
import { resizeTargetChanged } from '@main/windowResize';

describe('resizeTargetChanged', () => {
  it('accepts a different target size', () => {
    expect(resizeTargetChanged({ width: 650, height: 98 }, { width: 650, height: 121 })).toBe(true);
    expect(resizeTargetChanged({ width: 650, height: 121 }, { width: 900, height: 121 })).toBe(true);
  });

  it('is a no-op at the requested size', () => {
    expect(resizeTargetChanged({ width: 650, height: 121 }, { width: 650, height: 121 })).toBe(false);
  });
});
