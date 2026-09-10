export function easeStep(current: number, target: number, factor = 0.35, epsilon = 1): number {
  if (Math.abs(target - current) <= epsilon) {
    return target;
  }
  return current + (target - current) * factor;
}
