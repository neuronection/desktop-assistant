import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateChannel, UpdateRelease } from '@shared/types';
import { compareSemver, parseSemver } from './semver';

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version?: string }) => void): unknown;
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<string>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  setFeedURL(options: { provider: string; url: string }): void;
}

export interface InstallerSupport {
  supported: boolean;
  reason: 'dev' | 'no-asset' | 'updater-unavailable' | null;
}

export type InstallerApplyResult = { ok: true } | { ok: false; reason: string };

export interface UpdateInstallerLike {
  support(): InstallerSupport;
  mode(): 'in-place' | 'wizard';
  apply(release: UpdateRelease): Promise<InstallerApplyResult>;
  install(): void;
}

export interface UpdateInstallerDeps {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  isAppImage?: boolean;
  arch?: string;
  channel: () => UpdateChannel;
  downloadDir?: string;
  openPath?: (path: string) => Promise<void>;
  onProgress?: (percent: number) => void;
  onDownloaded?: () => void;
  loadUpdater?: () => Promise<AutoUpdaterLike | null>;
  e2eFeedUrl?: string | null;
}

const ASSET_TIMEOUT_MS = 10 * 60_000;

function installerFileName(assetUrl: string): string | null {
  const raw = new URL(assetUrl).pathname.split('/').pop() ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const name = basename(decoded);
  if (!name || name !== decoded || name === '.' || name === '..' || /[\\/]/.test(decoded) || decoded.includes('\0')) {
    return null;
  }
  return name;
}

function checksumsUrl(assetUrl: string): string {
  const url = new URL(assetUrl);
  const index = url.pathname.lastIndexOf('/');
  if (index < 0) {
    throw new Error(`invalid asset URL: ${assetUrl}`);
  }
  url.pathname = `${url.pathname.slice(0, index + 1)}SHA256SUMS.txt`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export class UpdateInstaller {
  private readonly platform: NodeJS.Platform;
  private readonly isPackaged: boolean;
  private readonly isAppImage: boolean;
  private readonly arch: string;
  private readonly channel: () => UpdateChannel;
  private readonly downloadDir: string | null;
  private readonly openPath: (path: string) => Promise<void>;
  private readonly onProgress: (percent: number) => void;
  private readonly onDownloaded: () => void;
  private readonly loadUpdater: () => Promise<AutoUpdaterLike | null>;
  private readonly e2eFeedUrl: string | null;
  private updater: AutoUpdaterLike | null = null;
  private wired = false;

  constructor(deps: UpdateInstallerDeps) {
    this.platform = deps.platform ?? process.platform;
    this.isPackaged = deps.isPackaged ?? true;
    this.isAppImage = deps.isAppImage ?? Boolean(process.env.APPIMAGE);
    this.arch = deps.arch ?? process.arch;
    this.channel = deps.channel;
    this.downloadDir = deps.downloadDir ?? null;
    this.openPath =
      deps.openPath ??
      (async (path) => {
        const { shell } = await import('electron');
        const error = await shell.openPath(path);
        if (error) {
          throw new Error(error);
        }
      });
    this.onProgress = deps.onProgress ?? (() => undefined);
    this.onDownloaded = deps.onDownloaded ?? (() => undefined);
    this.loadUpdater = deps.loadUpdater ?? loadAutoUpdater;
    this.e2eFeedUrl =
      deps.e2eFeedUrl ??
      (process.env.DESKTOP_UPDATE_E2E === '1' ? process.env.DESKTOP_UPDATE_E2E_URL ?? null : null);
  }

  support(): InstallerSupport {
    if (!this.isPackaged) return { supported: false, reason: 'dev' };
    return { supported: true, reason: null };
  }

  mode(): 'in-place' | 'wizard' {
    return this.platform === 'linux' && this.isAppImage ? 'in-place' : 'wizard';
  }

  async apply(offered: UpdateRelease): Promise<InstallerApplyResult> {
    if (!this.isPackaged) return { ok: false, reason: 'dev' };
    try {
      if (this.mode() === 'in-place') return await this.applyInPlace(offered);
      return await this.applyWizard(offered);
    } catch (error) {
      return {
        ok: false,
        reason: `apply-failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  install(): void {
    this.updater?.quitAndInstall(false, true);
  }

  private async applyInPlace(offered: UpdateRelease): Promise<InstallerApplyResult> {
    const updater = await this.resolveUpdater();
    if (!updater) return { ok: false, reason: 'updater-unavailable' };

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = this.channel() === 'beta';
    if (this.e2eFeedUrl) {
      updater.setFeedURL({ provider: 'generic', url: this.e2eFeedUrl });
    }
    const result = await updater.checkForUpdates();
    const feedVersion = result?.updateInfo?.version ?? null;
    const offeredParsed = parseSemver(offered.version);
    const feedParsed = feedVersion ? parseSemver(feedVersion) : null;
    if (!offeredParsed || !feedParsed || compareSemver(feedParsed, offeredParsed) !== 0) {
      return {
        ok: false,
        reason: `feed-disagreement: the version API offers ${offered.version}, the update feed serves ${feedVersion ?? 'nothing'}`,
      };
    }
    await updater.downloadUpdate();
    return { ok: true };
  }

  private async applyWizard(offered: UpdateRelease): Promise<InstallerApplyResult> {
    const assetUrl = this.pickAsset(offered);
    if (!assetUrl) return { ok: false, reason: 'no-asset' };

    const fileName = installerFileName(assetUrl);
    if (!fileName) return { ok: false, reason: 'invalid-asset' };

    const dir = this.downloadDir ?? (await mkdtemp(join(tmpdir(), 'neuronection-updates-')));
    const dest = join(dir, fileName);

    try {
      await this.downloadAndVerify(assetUrl, checksumsUrl(assetUrl), fileName, dest, dir);
    } catch (error) {
      await rm(dest, { force: true });
      return {
        ok: false,
        reason: `download-failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    try {
      await this.openPath(dest);
    } catch (error) {
      return {
        ok: false,
        reason: `open-failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { ok: true };
  }

  private pickAsset(offered: UpdateRelease): string | null {
    const assets = offered.assets ?? {};
    if (this.platform === 'win32') return assets.windows?.exe ?? null;
    if (this.platform === 'darwin') {
      const macos = assets.macos ?? {};
      if (this.arch === 'arm64') return macos['dmg-arm64'] ?? macos.dmg ?? null;
      return macos.dmg ?? null;
    }
    if (this.platform === 'linux') return assets.linux?.deb ?? null;
    return null;
  }

  private async downloadAndVerify(
    assetUrl: string,
    sumsUrl: string,
    fileName: string,
    dest: string,
    dir: string,
  ): Promise<void> {
    const expected = await this.expectedChecksum(sumsUrl, fileName);
    if (!expected) {
      throw new Error(`checksum unavailable for ${fileName}`);
    }
    await mkdir(dir, { recursive: true });
    const response = await fetch(assetUrl, { signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) });
    if (!response.ok || !response.body) {
      throw new Error(`asset download failed with ${response.status}`);
    }
    const total = Number(response.headers.get('content-length') ?? '0');
    const hash = createHash('sha256');
    let received = 0;
    let lastReported = -1;
    const progress = new Transform({
      transform: (chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) => {
        received += chunk.length;
        hash.update(chunk);
        if (total > 0) {
          const percent = Math.min(100, Math.round((received / total) * 100));
          if (percent !== lastReported) {
            lastReported = percent;
            this.onProgress(percent);
          }
        }
        callback(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(dest));

    if (total > 0 && received !== total) {
      await rm(dest, { force: true });
      throw new Error(`truncated download for ${fileName}`);
    }
    if (hash.digest('hex') !== expected) {
      await rm(dest, { force: true });
      throw new Error(`checksum mismatch for ${fileName}`);
    }
  }

  private async expectedChecksum(sumsUrl: string, fileName: string): Promise<string | null> {
    const response = await fetch(sumsUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.text();
    for (const line of body.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2 && parts[1] === fileName && /^[0-9a-f]{64}$/.test(parts[0])) {
        return parts[0];
      }
    }
    return null;
  }

  private async resolveUpdater(): Promise<AutoUpdaterLike | null> {
    if (this.updater) return this.updater;
    const updater = await this.loadUpdater();
    if (!updater) return null;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    if (!this.wired) {
      updater.on('download-progress', (progress) => {
        this.onProgress(Math.round(progress.percent));
      });
      updater.on('update-downloaded', () => {
        this.onDownloaded();
      });
      this.wired = true;
    }
    this.updater = updater;
    return updater;
  }
}

async function loadAutoUpdater(): Promise<AutoUpdaterLike | null> {
  const specifier: string = 'electron-updater';
  try {
    const mod = (await import(specifier)) as { autoUpdater?: AutoUpdaterLike };
    return mod.autoUpdater ?? null;
  } catch {
    return null;
  }
}
