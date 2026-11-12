import type { CaptureService } from '@main/services/capture/CaptureService';

/**
 * The capture engine bridge for native tools (plan 80 S9).
 *
 * Tools are constructed once at module load, long before the IPC composition
 * root builds the engine, so the service arrives through a setter — the same
 * shape `ToolResultService` uses. Tests that call a tool directly simply leave
 * it unset.
 */
let service: CaptureService | null = null;

export function setCaptureService(next: CaptureService): void {
  service = next;
}

export function getCaptureService(): CaptureService | null {
  return service;
}
