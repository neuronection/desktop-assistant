import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';

const MAX_BYTES = 1_000_000;
const KEEP = 3;

let logPath: string | null = null;

/**
 * A rotating `userData/logs/main.log`. `console` output is invisible in a
 * packaged Windows build (GUI subsystem, no stdout) and there is no terminal
 * to read it from on any platform — a boot failure otherwise leaves nothing
 * behind to diagnose.
 */
export function initLogger(directory?: string): string {
  const base = directory ?? app.getPath('userData');
  const dir = join(base, 'logs');
  mkdirSync(dir, { recursive: true });
  logPath = join(dir, 'main.log');
  return logPath;
}

export function currentLogPath(): string | null {
  return logPath;
}

function rotate(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  try {
    if (statSync(path).size < MAX_BYTES) {
      return;
    }
  } catch {
    return;
  }
  for (let index = KEEP - 1; index >= 1; index -= 1) {
    const from = `${path}.${index}`;
    if (existsSync(from)) {
      renameSync(from, `${path}.${index + 1}`);
    }
  }
  renameSync(path, `${path}.1`);
}

export function logLine(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const path = logPath ?? initLogger();
    rotate(path);
    appendFileSync(path, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`);
  } catch {
    // Logging never breaks the app.
  }
}
