import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegionCapture } from '@main/services/capture/region';
import {
  captureTempDir,
  ensureCaptureTempDir,
  sweepCaptureTemp,
} from '@main/services/capture/temp';

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(process.cwd(), 'node_modules', '.tmp', 'capture-temp-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('capture temp directory', () => {
  it('lives beside the database, not in the shared temp root', () => {
    expect(captureTempDir('/home/u/.config/app')).toBe('/home/u/.config/app/capture-tmp');
  });

  it('creates the directory 0700 and is idempotent', async () => {
    const dir = join(directory, 'nested', 'capture-tmp');
    await ensureCaptureTempDir(dir);
    await ensureCaptureTempDir(dir);
    const mode = (await stat(dir)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('sweeps every file at boot, keeping directories and honouring an age floor', async () => {
    const dir = join(directory, 'capture-tmp');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'stale.png'), 'x');
    await writeFile(join(dir, 'fresh.png'), 'x');
    await mkdir(join(dir, 'keep-me'), { recursive: true });

    const now = Date.now();
    const old = new Date(now - 60 * 60_000);
    await utimes(join(dir, 'stale.png'), old, old);
    expect(await sweepCaptureTemp(dir, { now, maxAgeMs: 5 * 60_000 })).toBe(1);

    const remaining = await readdir(dir);
    expect(remaining.sort()).toEqual(['fresh.png', 'keep-me']);

    expect(await sweepCaptureTemp(dir)).toBe(1);
    expect(await readdir(dir)).toEqual(['keep-me']);
  });

  it('treats a missing directory as nothing to sweep', async () => {
    expect(await sweepCaptureTemp(join(directory, 'nope'))).toBe(0);
  });
});

describe('region capture temp hygiene', () => {
  it('removes its file after a successful capture', async () => {
    const capture = new RegionCapture({
      platform: 'linux',
      directory: () => directory,
      exec: async (file, args) => {
        if (args[0] === '--version') {
          return 'gnome-screenshot 41';
        }
        const target = args[args.length - 1] as string;
        await writeFile(target, Buffer.from('png'));
        return '';
      },
      readFile: async () => Buffer.from('png'),
      encodeImage: () => ({ jpeg: Buffer.from('jpeg'), width: 640, height: 480 }),
    });
    const result = await capture.capture();
    expect(result).not.toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('removes a partial file when the tool fails or the user cancels', async () => {
    const capture = new RegionCapture({
      platform: 'linux',
      directory: () => directory,
      exec: async (file, args) => {
        if (args[0] === '--version') {
          return 'gnome-screenshot 41';
        }
        await writeFile(args[args.length - 1] as string, Buffer.from('partial'));
        throw Object.assign(new Error('exit 1'), { code: 1 });
      },
      readFile: async () => Buffer.from('partial'),
      encodeImage: () => ({ jpeg: Buffer.from('jpeg'), width: 640, height: 480 }),
    });
    expect(await capture.capture()).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('creates the directory it was pointed at', async () => {
    const target = join(directory, 'capture-tmp');
    const capture = new RegionCapture({
      platform: 'linux',
      directory: () => target,
      exec: async (file, args) => {
        if (args[0] === '--version') {
          return 'ok';
        }
        await writeFile(args[args.length - 1] as string, Buffer.from('png'));
        return '';
      },
      readFile: async () => Buffer.from('png'),
      encodeImage: () => ({ jpeg: Buffer.from('jpeg'), width: 640, height: 480 }),
    });
    await capture.capture();
    expect((await stat(target)).mode & 0o777).toBe(0o700);
  });
});

describe('region tool probing', () => {
  it('picks the first installed tool and stops probing', async () => {
    const probed: string[] = [];
    const capture = new RegionCapture({
      platform: 'linux',
      directory: () => directory,
      exec: async (file) => {
        probed.push(file);
        if (file === 'gnome-screenshot') {
          throw new Error('ENOENT');
        }
        return 'ok';
      },
      readFile: async () => Buffer.from('png'),
    });
    expect(await capture.available()).toBe(true);
    expect(probed).toEqual(['gnome-screenshot', 'spectacle']);
    expect(capture).toBeTruthy();
  });

  it('reports unavailable when no tool answers', async () => {
    const capture = new RegionCapture({
      platform: 'linux',
      directory: () => directory,
      exec: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(await capture.available()).toBe(false);
    expect(await capture.capture()).toBeNull();
  });
});
