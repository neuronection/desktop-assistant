import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { nativeImage } from 'electron';
import { boundedJpeg, type NativeImageLike } from './sources';

export type CaptureExec = (file: string, args: string[], options: { timeout: number }) => Promise<string>;
export type ReadFile = (path: string) => Promise<Buffer>;

export interface RegionTool {
  file: string;
  buildArgs(path: string): string[];
}

export interface EncodedImage {
  jpeg: Buffer;
  width: number;
  height: number;
}

/**
 * Region capture, natively (owner feedback 2026-11-12).
 *
 * The app does not paint its own full-screen selection surface any more: it
 * hands the gesture to the OS tool that already exists (GNOME/KDE/XFCE, macOS
 * `screencapture`, the Windows snipping overlay) and reads the result. The
 * only thing we add is the probe — when no native tool exists, the region row
 * simply is not offered.
 */
const LINUX_TOOLS: RegionTool[] = [
  { file: 'gnome-screenshot', buildArgs: (path) => ['-a', '-f', path] },
  { file: 'spectacle', buildArgs: (path) => ['-r', '-b', '-n', '-o', path] },
  { file: 'xfce4-screenshooter', buildArgs: (path) => ['-r', '-s', path] },
  { file: 'maim', buildArgs: (path) => ['-s', path] },
  { file: 'scrot', buildArgs: (path) => ['-s', path] },
];

const MACOS_TOOL: RegionTool = {
  file: 'screencapture',
  buildArgs: (path) => ['-i', '-x', path],
};

const PROBE_TIMEOUT_MS = 2_500;
const CAPTURE_TIMEOUT_MS = 180_000;

export interface RegionCaptureDeps {
  platform?: NodeJS.Platform;
  exec?: CaptureExec;
  readFile?: ReadFile;
  /** Where the OS tool writes its file (userData/capture). */
  directory?: () => string;
  /** Windows: the snipping overlay hands the result over on the clipboard. */
  readClipboardImage?: () => Promise<Buffer | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultExec: CaptureExec = (file, args, options) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: options.timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout));
    });
  });

export class RegionCapture {
  private tool: RegionTool | null | undefined;
  private readonly exec: CaptureExec;
  private readonly readFile: ReadFile;
  private readonly platform: NodeJS.Platform;
  private sequence = 0;

  constructor(private readonly deps: RegionCaptureDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.exec = deps.exec ?? defaultExec;
    this.readFile = deps.readFile ?? ((path) => fs.readFile(path));
  }

  /** Probe once per boot; a missing helper is a capability gap, not an error. */
  public async toolFor(): Promise<RegionTool | null> {
    if (this.tool !== undefined) {
      return this.tool;
    }
    if (this.platform === 'darwin') {
      this.tool = MACOS_TOOL;
      return this.tool;
    }
    if (this.platform !== 'linux') {
      this.tool = null;
      return this.tool;
    }
    for (const candidate of LINUX_TOOLS) {
      try {
        await this.exec(candidate.file, ['--version'], { timeout: PROBE_TIMEOUT_MS });
        this.tool = candidate;
        return this.tool;
      } catch {
        // try the next one
      }
    }
    this.tool = null;
    return this.tool;
  }

  public async available(): Promise<boolean> {
    if (this.platform === 'win32') {
      return true;
    }
    return (await this.toolFor()) !== null;
  }

  /** Decode the OS tool's output into a bounded JPEG. */
  public async capture(): Promise<EncodedImage | null> {
    if (this.platform === 'win32') {
      return this.captureWindows();
    }
    const tool = await this.toolFor();
    if (!tool) {
      return null;
    }
    const path = join(this.deps.directory?.() ?? '/tmp', `capture-${process.pid}-${++this.sequence}.png`);
    try {
      await this.exec(tool.file, tool.buildArgs(path), { timeout: CAPTURE_TIMEOUT_MS });
    } catch {
      return null;
    }
    let raw: Buffer;
    try {
      raw = await this.readFile(path);
    } catch {
      return null;
    } finally {
      void fs.rm(path, { force: true }).catch(() => undefined);
    }
    return this.encodeBytes(raw);
  }

  private encodeBytes(raw: Buffer): EncodedImage | null {
    if (raw.length === 0) {
      return null;
    }
    const image = nativeImage.createFromBuffer(raw);
    return boundedJpeg(image as unknown as NativeImageLike);
  }

  private async captureWindows(): Promise<EncodedImage | null> {
    const before = await this.deps.readClipboardImage?.().catch(() => null);
    try {
      await this.exec('cmd', ['/c', 'start', '', 'ms-screenclip:'], { timeout: PROBE_TIMEOUT_MS });
    } catch {
      return null;
    }
    const deadline = (this.deps.now?.() ?? Date.now()) + 60_000;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    while ((this.deps.now?.() ?? Date.now()) < deadline) {
      await sleep(400);
      const current = await this.deps.readClipboardImage?.().catch(() => null);
      if (current && (!before || !current.equals(before))) {
        return this.encodeBytes(current);
      }
    }
    return null;
  }
}

