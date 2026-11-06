export interface WindowSize {
  width: number;
  height: number;
}

/** A resize is one native `setBounds` for a changed size; an identical target
 * is a no-op. There is no per-frame easing loop on the launcher: X11 turns
 * each native resize into a configure/repaint round-trip, which reads as
 * flicker while a reply streams. */
export function resizeTargetChanged(current: WindowSize, target: WindowSize): boolean {
  return current.width !== target.width || current.height !== target.height;
}
