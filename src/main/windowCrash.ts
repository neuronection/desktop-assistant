import type { BrowserWindow } from 'electron';
import { TEXT } from '@shared/constants/text';
import { notifyUser } from '@main/services/NotificationService';

export type CrashRecoveryRole = 'launcher' | 'settings' | 'desktop' | 'result' | 'pack' | 'overlay';

export interface RenderCrashRecoveryOptions {
  role: CrashRecoveryRole;
  /** Present only for persistent windows: destroy the dead renderer and
   * bring the surface back. Transient windows (result/pack) just close. */
  recreate?: () => void | Promise<void>;
  log?: Pick<Console, 'error'>;
}

/** `render-process-gone` recovery (plan 46 S1): the death is logged, the
 * user gets one deduped notice, and persistent windows are recreated.
 * The handler is inert once the window object is already destroyed. */
export function attachRenderCrashRecovery(window: BrowserWindow, options: RenderCrashRecoveryOptions): void {
  const log = options.log ?? console;
  window.webContents.on('render-process-gone', (_event, details) => {
    if (window.isDestroyed()) {
      return;
    }
    log.error(`[render-process-gone:${options.role}] ${details.reason} (exit ${details.exitCode})`);
    if (!options.recreate) {
      return;
    }
    void notifyUser({
      kind: 'system',
      severity: 'error',
      title: TEXT.ERROR_RENDERER_CRASH_TITLE,
      body: TEXT.ERROR_RENDERER_CRASH_BODY,
      dedupeKey: `renderer-crash:${options.role}`,
      clickAction: 'none',
    }).catch((error) => log.error(`[render-process-gone:${options.role}] notice failed`, error));
    void Promise.resolve(options.recreate()).catch((error) =>
      log.error(`[render-process-gone:${options.role}] recreation failed`, error)
    );
  });
}
