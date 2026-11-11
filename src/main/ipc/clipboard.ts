import type { ClipboardService } from '@main/services/ClipboardService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface ClipboardIpcDeps {
  clipboardService: ClipboardService;
}

export function registerClipboardIpc({ clipboardService }: ClipboardIpcDeps): void {
  register(IPC['clipboard:list'], async (_event, query?: string) => clipboardService.list(query ?? ''));
  register(IPC['clipboard:status'], async () => clipboardService.status());
  register(IPC['clipboard:pin'], async (_event, id: string, pinned: boolean) => clipboardService.setPinned(id, pinned));
  register(IPC['clipboard:remove'], async (_event, id: string) => clipboardService.remove(id));
  register(IPC['clipboard:clear'], async () => {
    await clipboardService.clear();
    return true;
  });
  register(IPC['clipboard:copy'], async (_event, id: string) => clipboardService.copy(id));
}
