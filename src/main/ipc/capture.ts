import type { CaptureRequest } from '@shared/capture';
import { IPC } from '@shared/ipc/registry';
import type { CaptureService } from '@main/services/capture/CaptureService';
import { register } from './register';

export interface CaptureIpcDeps {
  service: CaptureService;
}

/** The capture channels (plan 80, rebuilt without a custom overlay). */
export function registerCaptureIpc({ service }: CaptureIpcDeps): void {
  register(IPC['capture:begin'], async (_event, request: CaptureRequest) => service.begin(request));
  register(IPC['capture:sources'], async () => service.listSources());
}
