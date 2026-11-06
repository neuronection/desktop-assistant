import { app } from 'electron';

export interface CrashLog {
  error: (...args: unknown[]) => void;
}

const SANDBOX_SERVICE_NAME = 'mini-app-sandbox';

/** Main-process crash posture (plan 46 S1): uncaught exceptions and
 * unhandled rejections are logged and swallowed — the tray app must
 * never die silently or half-exit mid-write. `child-process-gone` logs
 * every dead child; the sandbox branch points at the run record, whose
 * settlement (outcome `crashed` + reason, by run id) stays authoritative
 * in `SandboxService` — the process-level event carries no run identity
 * by design (the seam is fixed to the shared service name). */
export function installCrashHandlers(log: CrashLog = console): void {
  process.on('uncaughtException', (error) => {
    log.error('[main-crash:uncaughtException]', error);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('[main-crash:unhandledRejection]', reason);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.serviceName === SANDBOX_SERVICE_NAME) {
      log.error(
        `[child-process-gone] sandbox ${details.type} died: ${details.reason} (exit ${details.exitCode}) — settled in the sandbox run record (outcome/reason by run id)`
      );
      return;
    }
    log.error(`[child-process-gone] ${details.type} (${details.serviceName ?? 'unnamed'}): ${details.reason} (exit ${details.exitCode})`);
  });
}
