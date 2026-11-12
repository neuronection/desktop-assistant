import type { EgressMode } from '@shared/egress';
import type { OcrCapabilityReport } from '@shared/ai/ocr';
import type { CaptureService } from './CaptureService';
import type { OcrService } from '@main/services/ocr/OcrService';

/**
 * The *cheap* capability report (plan 82 S3): no `desktopCapturer`, no window
 * enumeration, no icons. It answers only "which modes are possible at all" so
 * the mode grid can paint on the same frame it opens.
 *
 * Window and screen *lists* are a separate, lazy call (`capture:sources`) made
 * when a tile is actually drilled into — enumerating windows is the slow part
 * and must never sit in front of the grid.
 */
export interface CaptureCapabilities {
  platform: NodeJS.Platform;
  egress: EgressMode;
  /** A native region tool exists (cached probe). */
  region: boolean;
  /** Display count from Electron's screen module: immediate, no capture. */
  screens: number;
  ocr: OcrCapabilityReport;
}

export async function describeCaptureCapabilities(deps: {
  capture: CaptureService;
  ocr: OcrService;
  platform: NodeJS.Platform;
  displayCount(): number;
}): Promise<CaptureCapabilities> {
  const [region, ocr] = await Promise.all([
    deps.capture.regionAvailable().catch(() => false),
    deps.ocr.capabilities(),
  ]);
  return {
    platform: deps.platform,
    egress: ocr.egress,
    region,
    screens: deps.displayCount(),
    ocr,
  };
}
