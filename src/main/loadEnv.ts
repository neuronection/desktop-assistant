import { app } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Load `.env` into `process.env` for the MAIN process (plan 52 setup path).
 *
 * electron-vite does not load `.env` into the main process — only Vite serves
 * it to the renderer — so a value written to `.env` (the file `.env.example`
 * documents) never reached `process.env`, and the calendar client ids could
 * not be configured the way the docs said. This closes that gap without a
 * dependency.
 *
 * Rules:
 * - an already-set env var always wins (a real shell/launchd setting beats a
 *   file, so CI and packagers are never surprised);
 * - values are NEVER logged — a `.env` can hold secrets;
 * - only `KEY=VALUE` lines are honoured; `#` comments and blanks are skipped;
 * - quotes around a value are stripped.
 */
export function loadEnvFile(path: string = envPath()): string[] {
  // Returns only the KEY names it set. The values stay in `process.env` and
  // are never handed back — a `.env` can hold secrets and a returned value is
  // one careless `console.log` away from a leak.
  const loaded: string[] = [];
  if (!existsSync(path)) {
    return loaded;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch {
    return loaded;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key] !== undefined) {
      continue; // never override a real environment setting
    }
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}

function envPath(): string {
  // dev: the repo root (next to package.json); packaged: beside the app's
  // userData so an operator can drop one in without rebuilding.
  try {
    if (app.isPackaged) {
      return join(app.getPath('userData'), '.env');
    }
    return join(app.getAppPath(), '.env');
  } catch {
    return join(process.cwd(), '.env');
  }
}
