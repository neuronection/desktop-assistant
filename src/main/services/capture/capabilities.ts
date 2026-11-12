import type { CaptureSourceList } from '@shared/capture';
import type { EgressMode } from '@shared/egress';
import type { OcrCapabilityReport } from '@shared/ai/ocr';
import type { CaptureService } from './CaptureService';
import type { OcrService } from '@main/services/ocr/OcrService';

export interface CaptureCapabilities extends CaptureSourceList {
  platform: NodeJS.Platform;
  egress: EgressMode;
  ocr: OcrCapabilityReport;
}

/**
 * The one report the mode grid, the result card and Settings read (plan 82).
 * A tile appears only when its capability is true here — no hidden failures.
 */
export async function describeCaptureCapabilities(deps: {
  capture: CaptureService;
  ocr: OcrService;
  platform: NodeJS.Platform;
}): Promise<CaptureCapabilities> {
  const [sources, ocr] = await Promise.all([deps.capture.listSources(), deps.ocr.capabilities()]);
  return { ...sources, platform: deps.platform, egress: ocr.egress, ocr };
}
