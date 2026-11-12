import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const CAPTURE_TEMP_DIR = 'capture-tmp';

/** Native-tool inputs live beside the database, not in the shared /tmp. */
export function captureTempDir(userData: string): string {
  return join(userData, CAPTURE_TEMP_DIR);
}

/**
 * 0700 directory for OS-tool inputs (region captures, tesseract images).
 * The directory mode is the control: whoever created a file inside it, other
 * local users cannot read the path.
 */
export async function ensureCaptureTempDir(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700).catch(() => undefined);
}

/**
 * Boot sweep: nothing in this directory is meant to survive a restart, so the
 * safe default removes every file (a crash between `exec` and cleanup leaves
 * exactly the kind of file this exists to remove). Directories and unreadable
 * entries are left alone; a missing directory is not an error.
 */
export async function sweepCaptureTemp(
  directory: string,
  options: { now?: number; maxAgeMs?: number } = {}
): Promise<number> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 0;
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const path = join(directory, entry);
    try {
      const info = await fs.stat(path);
      if (!info.isFile()) {
        continue;
      }
      if (maxAgeMs > 0 && now - info.mtimeMs < maxAgeMs) {
        continue;
      }
      await fs.rm(path, { force: true });
      removed += 1;
    } catch {
      // Raced with another process or a permission hole: never fatal.
    }
  }
  return removed;
}
