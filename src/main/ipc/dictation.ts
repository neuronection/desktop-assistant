import { webContents } from 'electron';
import type { DictationBeginResult, DictationService } from '@main/services/DictationService';
import { normalizeDictationPatch, type DictationOrigin, type DictationSnapshot } from '@shared/dictation';
import { IPC } from '@shared/ipc/registry';
import { register } from './register';

export interface DictationIpcDeps {
  service: DictationService;
  /** Push the session to every window (the HUD, the launcher, the desktop). */
  broadcast(snapshot: DictationSnapshot): void;
}

/**
 * The shared dictation session (plan 83 S1): any window may begin one, only
 * the owner may report or end it, and any window may ask the owner to stop.
 */
export function registerDictationIpc({ service, broadcast }: DictationIpcDeps): void {
  service.subscribe(broadcast);

  register(IPC['dictation:snapshot'], async () => service.snapshot());

  register(IPC['dictation:begin'], async (event, payload: { origin: DictationOrigin }) => {
    const result: DictationBeginResult = service.begin(payload.origin, event.sender.id);
    if (result.ok) {
      // A crashed or closed owner must not leave the session recording forever.
      event.sender.once('destroyed', () => service.end(event.sender.id, { force: true }));
    }
    return result;
  });

  register(IPC['dictation:report'], async (event, patch: Partial<DictationSnapshot>) => {
    const reported = service.report(event.sender.id, normalizeDictationPatch(patch ?? {}));
    return reported ?? service.snapshot();
  });

  register(IPC['dictation:end'], async (event) => service.end(event.sender.id));

  register(IPC['dictation:stop'], async () => {
    const owner = service.ownerId();
    if (owner === null) {
      return false;
    }
    const target = webContents.fromId(owner);
    if (!target || target.isDestroyed()) {
      service.end(owner, { force: true });
      return false;
    }
    target.send('dictation:request-stop');
    return true;
  });
}
