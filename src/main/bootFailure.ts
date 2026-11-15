import { app, dialog } from 'electron';
import { TEXT, interpolate } from '@shared/constants/text';
import { currentLogPath, initLogger, logLine } from '@main/log';

export interface BootFailureOptions {
  isDev: boolean;
  isSmoke: boolean;
  dataDirectory: string;
}

/**
 * A failed `initialize()` used to be logged and swallowed: the window, tray
 * and hotkeys all come *after* the database, so a refused lift left a live
 * process with no window, no tray and nothing to read (a packaged Windows
 * build has no stdout either). Say what happened, where the data and the log
 * are, then exit non-zero.
 */
export function reportBootFailure(error: unknown, options: BootFailureOptions): void {
  const message = error instanceof Error ? error.message : String(error);
  initLogger(options.dataDirectory);
  logLine('error', `initialize failed: ${message}`);
  console.error('Failed to initialize Desktop Assistant:', error);
  if (options.isDev || options.isSmoke) {
    return;
  }
  const logPath = currentLogPath() ?? '';
  dialog.showErrorBox(
    TEXT.BOOT_FAILED_TITLE,
    interpolate(TEXT.BOOT_FAILED_BODY, {
      message,
      dataDir: options.dataDirectory,
      logPath,
    })
  );
  app.exit(1);
}
