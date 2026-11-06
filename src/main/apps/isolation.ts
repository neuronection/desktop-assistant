import { t2IsolationForPlatform } from '@shared/app-pack/mapping';
import { TEXT, interpolate } from '@shared/constants/text';

/** The platform's containment grade, resolved main-side (plan 47 D3). */
export function desktopT2Isolation(): string {
  return t2IsolationForPlatform(process.platform);
}

export function t2IsolationBlocksImports(grade: string = desktopT2Isolation()): boolean {
  return grade === 'none';
}

/** The plain-language explanation shown when a T2 import/enable is refused. */
export function t2IsolationBlockReason(grade: string = desktopT2Isolation()): string {
  return interpolate(TEXT.MINIAPPS_T2_BLOCKED, { grade });
}
