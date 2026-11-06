import { describe, it, expect } from 'vitest';
import {
  LAUNCHER_RESIZE_MIN_DELTA_PX,
  planLauncherResize,
  quantizeLauncherHeight,
  shouldGrowLauncher,
  shouldShrinkLauncher,
} from '@renderer/chat-react/launcherResize';

describe('launcher resize plan', () => {
  it('grows by one measured step while streaming', () => {
    expect(planLauncherResize(162, 214, true)).toBe(214);
    expect(planLauncherResize(162, 214, false)).toBe(214);
  });

  it('never shrinks while the reply is streaming', () => {
    expect(planLauncherResize(219, 214, true)).toBe(219);
    expect(planLauncherResize(219, 214, false)).toBe(214);
  });

  it('ignores sub-pixel and jitter-level changes', () => {
    expect(shouldGrowLauncher(162, 162 + LAUNCHER_RESIZE_MIN_DELTA_PX - 0.5)).toBe(false);
    expect(shouldShrinkLauncher(162, 162 - LAUNCHER_RESIZE_MIN_DELTA_PX + 0.5)).toBe(false);
    expect(planLauncherResize(162, 163, true)).toBe(162);
    expect(planLauncherResize(162, 163, false)).toBe(162);
  });

  it('rounds measured heights up so the window never clips a fractional row', () => {
    expect(quantizeLauncherHeight(214.2)).toBe(215);
    expect(planLauncherResize(100, 214.2, true)).toBe(215);
  });
});
