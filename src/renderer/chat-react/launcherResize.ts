export const LAUNCHER_RESIZE_MIN_DELTA_PX = 2;
export const LAUNCHER_RESIZE_SETTLE_MS = 160;

export function quantizeLauncherHeight(height: number): number {
  return Math.max(1, Math.ceil(height));
}

export function shouldGrowLauncher(current: number, desired: number, minDelta = LAUNCHER_RESIZE_MIN_DELTA_PX): boolean {
  return desired - current >= minDelta;
}

export function shouldShrinkLauncher(current: number, desired: number, minDelta = LAUNCHER_RESIZE_MIN_DELTA_PX): boolean {
  return current - desired >= minDelta;
}

/** Streaming may only grow the native window; a reply can reflow smaller for
 * a frame while markdown settles, and shrinking mid-stream is the visible
 * bounce. Shrinks wait for the settled state. */
export function planLauncherResize(current: number, desired: number, streaming: boolean): number {
  if (shouldGrowLauncher(current, desired)) {
    return quantizeLauncherHeight(desired);
  }
  if (!streaming && shouldShrinkLauncher(current, desired)) {
    return quantizeLauncherHeight(desired);
  }
  return current;
}
