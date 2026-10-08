import { readdir, realpath, stat, open } from 'fs/promises';
import type { PackDirEntry, PackFsDeps, PackStat } from './fs';

function toPackStat(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; dev: number; size: number; mtimeMs: number }): PackStat {
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymbolicLink: stats.isSymbolicLink(),
    dev: stats.dev,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

/** Production deps: real Node fs behind the injectable seam. */
export const nodePackFsDeps: PackFsDeps = {
  realpath: (path) => realpath(path),
  stat: async (path) => toPackStat(await stat(path)),
  readdir: async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map(
      (entry): PackDirEntry => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      })
    );
  },
  readFileHead: async (path, maxBytes) => {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      const size = (await handle.stat()).size;
      return { buffer: buffer.subarray(0, bytesRead), truncated: size > bytesRead };
    } finally {
      await handle.close();
    }
  },
};
