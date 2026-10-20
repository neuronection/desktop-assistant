export function easeStep(current: number, target: number, factor = 0.35, epsilon = 1): number {
  if (Math.abs(target - current) <= epsilon) {
    return target;
  }
  return current + (target - current) * factor;
}

/**
 * Should a resize request be queued? While an eased resize is in flight the
 * reported size can briefly equal the new target (or a stale tick is still
 * running) — an equality early-return would then drop the newer target and
 * the stale animation would win (the reload race that clipped the launcher
 * at 98 px above a 121 px chrome). Always queue while animating; only an
 * idle window at the requested size is a true no-op.
 */
export function resizeTargetChanged(
  current: { width: number; height: number },
  target: { width: number; height: number },
  animating: boolean
): boolean {
  if (animating) return true;
  return current.width !== target.width || current.height !== target.height;
}
