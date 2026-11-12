import type { CaptureRequest, CaptureSelection } from '@shared/capture';
import { IPC } from '@shared/ipc/registry';
import type { CaptureService } from '@main/services/capture/CaptureService';
import type { CaptureOverlayController } from '@main/services/capture/overlay';
import { register } from './register';

export interface CaptureIpcDeps {
  service: CaptureService;
  overlay: CaptureOverlayController;
}

/** The capture channels (plan 80): one entry point, one overlay handshake. */
export function registerCaptureIpc({ service, overlay }: CaptureIpcDeps): void {
  register(IPC['capture:begin'], async (_event, request: CaptureRequest) => service.begin(request));
  register(IPC['capture:overlay-ready'], () => {
    overlay.markReady();
  });
  register(IPC['capture:commit'], (_event, selection: CaptureSelection) => overlay.commit(selection));
  register(IPC['capture:cancel'], () => {
    overlay.cancel();
  });
}
