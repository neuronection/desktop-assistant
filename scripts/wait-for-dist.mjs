import { statSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'dist/preload/preload.generated.js',
  'dist/main/main.js',
  'dist/shared/ipc/registry.js',
  'dist/shared/speech.js',
];
const STABLE_MS = 800;
const TIMEOUT_MS = 30_000;
const POLL_MS = 150;

const startedAt = Date.now();
const last = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

while (Date.now() - startedAt < TIMEOUT_MS) {
  const now = Date.now();
  let stable = true;
  for (const file of FILES) {
    try {
      const mtime = statSync(join(process.cwd(), file)).mtimeMs;
      const previous = last.get(file);
      if (previous === undefined || previous.mtime !== mtime) {
        last.set(file, { mtime, at: now });
        stable = false;
      } else if (now - previous.at < STABLE_MS) {
        stable = false;
      }
    } catch {
      stable = false;
    }
  }
  if (stable) {
    process.exit(0);
  }
  await sleep(POLL_MS);
}

console.warn('[dev] main/preload build did not settle in 30 s; starting Electron anyway');
process.exit(0);
