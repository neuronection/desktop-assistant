import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateInstaller, type AutoUpdaterLike } from '@main/services/updates/updater';
import type { UpdateRelease } from '@shared/types';

const release: UpdateRelease = {
  version: '0.11.0',
  tag: 'v0.11.0',
  channel: 'stable',
  publishedAt: '2026-10-30T00:00:00Z',
  url: 'https://github.com/neuronection/desktop-assistant/releases/tag/v0.11.0',
  assets: {
    linux: {
      appimage: 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/Desktop-Assistant-0.11.0-linux.AppImage',
      deb: 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/Desktop-Assistant-0.11.0-linux.deb',
    },
    windows: {
      exe: 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/Desktop-Assistant-0.11.0-setup.exe',
    },
    macos: {
      dmg: 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/Desktop-Assistant-0.11.0-x64.dmg',
      'dmg-arm64': 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/Desktop-Assistant-0.11.0-arm64.dmg',
    },
  },
};

const PAYLOAD = 'installer-bytes';
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex');
const SUMS = [
  `${PAYLOAD_SHA}  Desktop-Assistant-0.11.0-setup.exe`,
  `${PAYLOAD_SHA}  Desktop-Assistant-0.11.0-linux.deb`,
  `${PAYLOAD_SHA}  Desktop-Assistant-0.11.0-x64.dmg`,
  `${PAYLOAD_SHA}  Desktop-Assistant-0.11.0-arm64.dmg`,
].join('\n');

function fetchMockFor(status = 200) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.endsWith('SHA256SUMS.txt')) {
      return new Response(SUMS, { status });
    }
    return new Response(Readable.toWeb(Readable.from([Buffer.from(PAYLOAD)])) as never, { status });
  });
  return fetchMock;
}

function fakeUpdater(version: string | null): AutoUpdaterLike {
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    on: vi.fn(() => undefined) as never,
    checkForUpdates: vi.fn(async () => (version ? { updateInfo: { version } } : null)),
    downloadUpdate: vi.fn(async () => '/tmp/staged'),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  };
}

describe('UpdateInstaller support matrix (plan 48 W5a amendment: wizard hand-off)', () => {
  it('refuses only dev builds', () => {
    expect(new UpdateInstaller({ ...baseFor('win32'), isPackaged: false }).support()).toEqual({
      supported: false,
      reason: 'dev',
    });
    expect(new UpdateInstaller({ ...baseFor('win32') }).support()).toEqual({
      supported: true,
      reason: null,
    });
  });

  it('routes AppImage on Linux to the in-place updater and everything else to the wizard', () => {
    expect(new UpdateInstaller({ ...baseFor('linux'), isAppImage: true }).mode()).toBe('in-place');
    expect(new UpdateInstaller({ ...baseFor('linux'), isAppImage: false }).mode()).toBe('wizard');
    expect(new UpdateInstaller({ ...baseFor('win32') }).mode()).toBe('wizard');
    expect(new UpdateInstaller({ ...baseFor('darwin') }).mode()).toBe('wizard');
  });
});

function baseFor(platform: NodeJS.Platform) {
  return {
    platform,
    isPackaged: true,
    isAppImage: platform === 'linux',
    channel: vi.fn((): 'stable' | 'beta' => 'stable'),
  };
}

describe('UpdateInstaller wizard apply (download → verify → hand off)', () => {
  let downloadDir: string;

  beforeEach(() => {
    downloadDir = mkdtempSync(join(tmpdir(), 'da-updates-'));
    vi.stubGlobal('fetch', fetchMockFor());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
  });

  it('downloads the platform installer, verifies the checksum, and hands off to the OS', async () => {
    const loadUpdater = vi.fn(async () => fakeUpdater('0.11.0'));
    const openPath = vi.fn(async () => undefined);
    const installer = new UpdateInstaller({
      ...baseFor('win32'),
      downloadDir,
      openPath,
      loadUpdater,
    });
    const result = await installer.apply(release);
    expect(result).toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(join(downloadDir, 'Desktop-Assistant-0.11.0-setup.exe'));
    expect(await readFile(join(downloadDir, 'Desktop-Assistant-0.11.0-setup.exe'), 'utf8')).toBe(PAYLOAD);
    expect(loadUpdater).not.toHaveBeenCalled();
  });

  it('picks the arm64 dmg on arm64 macs and the x64 dmg otherwise', async () => {
    const openPath = vi.fn(async () => undefined);
    const arm = new UpdateInstaller({ ...baseFor('darwin'), arch: 'arm64', downloadDir, openPath });
    await arm.apply(release);
    expect(openPath).toHaveBeenCalledWith(join(downloadDir, 'Desktop-Assistant-0.11.0-arm64.dmg'));

    rmSync(downloadDir, { recursive: true, force: true });
    mkdtempSync(join(tmpdir(), 'da-updates-'));
    const x64 = new UpdateInstaller({ ...baseFor('darwin'), arch: 'x64', downloadDir, openPath });
    await x64.apply(release);
    expect(openPath).toHaveBeenCalledWith(join(downloadDir, 'Desktop-Assistant-0.11.0-x64.dmg'));
  });

  it('hands .deb files to the system installer too (wizard, not link-out)', async () => {
    const openPath = vi.fn(async () => undefined);
    const installer = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: false,
      downloadDir,
      openPath,
    });
    expect(await installer.apply(release)).toEqual({ ok: true });
    expect(openPath).toHaveBeenCalledWith(join(downloadDir, 'Desktop-Assistant-0.11.0-linux.deb'));
  });

  it('refuses and cleans up on a checksum mismatch', async () => {
    vi.stubGlobal('fetch', fetchMockFor(200));
    const sumsTampered = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith('SHA256SUMS.txt')) {
        return new Response(`${'b'.repeat(64)}  Desktop-Assistant-0.11.0-setup.exe`, { status: 200 });
      }
      return new Response(Readable.toWeb(Readable.from([Buffer.from(PAYLOAD)])) as never, { status: 200 });
    });
    vi.stubGlobal('fetch', sumsTampered);
    const openPath = vi.fn(async () => undefined);
    const installer = new UpdateInstaller({ ...baseFor('win32'), downloadDir, openPath });
    const result = await installer.apply(release);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('checksum mismatch');
    expect(openPath).not.toHaveBeenCalled();
    expect(existsSync(join(downloadDir, 'Desktop-Assistant-0.11.0-setup.exe'))).toBe(false);
  });

  it('refuses with no-asset when the platform has no installer', async () => {
    const installer = new UpdateInstaller({
      ...baseFor('win32'),
      downloadDir,
      openPath: vi.fn(async () => undefined),
    });
    const result = await installer.apply({ ...release, assets: undefined });
    expect(result).toEqual({ ok: false, reason: 'no-asset' });
  });

  it('keeps the in-place feed cross-check on AppImage (disagreement ⇒ nobody updates)', async () => {
    const updater = fakeUpdater('0.10.0');
    const installer = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: true,
      loadUpdater: async () => updater,
      downloadDir,
      openPath: vi.fn(async () => undefined),
    });
    const result = await installer.apply({ ...release, version: '0.11.0' });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('feed-disagreement');
  });

  it('reads SHA256SUMS from the release download base, not the tag page', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        urls.push(target);
        if (target.endsWith('SHA256SUMS.txt')) {
          return new Response(SUMS, { status: 200 });
        }
        return new Response(Readable.toWeb(Readable.from([Buffer.from(PAYLOAD)])) as never, { status: 200 });
      })
    );
    const installer = new UpdateInstaller({
      ...baseFor('win32'),
      downloadDir,
      openPath: vi.fn(async () => undefined),
    });
    expect(await installer.apply(release)).toEqual({ ok: true });
    expect(urls).toContain(
      'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/SHA256SUMS.txt'
    );
    expect(urls.some((url) => url.includes('/tag/') && url.endsWith('SHA256SUMS.txt'))).toBe(false);
  });

  it('fails closed when SHA256SUMS is unavailable', async () => {
    const openPath = vi.fn(async () => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        if (target.endsWith('SHA256SUMS.txt')) {
          return new Response('missing', { status: 404 });
        }
        return new Response(Readable.toWeb(Readable.from([Buffer.from(PAYLOAD)])) as never, { status: 200 });
      })
    );
    const installer = new UpdateInstaller({ ...baseFor('win32'), downloadDir, openPath });
    const result = await installer.apply(release);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('checksum unavailable');
    expect(openPath).not.toHaveBeenCalled();
    expect(existsSync(join(downloadDir, 'Desktop-Assistant-0.11.0-setup.exe'))).toBe(false);
  });

  it('refuses a percent-encoded path traversal in the asset name', async () => {
    const openPath = vi.fn(async () => undefined);
    const installer = new UpdateInstaller({ ...baseFor('win32'), downloadDir, openPath });
    const malicious: UpdateRelease = {
      ...release,
      assets: {
        ...release.assets,
        windows: {
          exe: 'https://github.com/neuronection/desktop-assistant/releases/download/v0.11.0/%2e%2e%2f%2e%2e%2f.bashrc',
        },
      },
    };
    expect(await installer.apply(malicious)).toEqual({ ok: false, reason: 'invalid-asset' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('disables electron-updater auto-install on quit', async () => {
    const updater = fakeUpdater('0.11.0');
    const installer = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: true,
      loadUpdater: async () => updater,
    });
    await installer.apply(release);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('sets allowPrerelease from the channel so rc feeds reach beta clients only', async () => {
    const updater = fakeUpdater('0.11.0-rc.1');
    const channel = vi.fn((): 'stable' | 'beta' => 'beta');
    const installer = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: true,
      channel,
      loadUpdater: async () => updater,
    });
    await installer.apply({ ...release, version: '0.11.0-rc.1', channel: 'beta' });
    expect(updater.allowPrerelease).toBe(true);
  });

  it('redirects the feed only when the E2E gate is on (never in prod)', async () => {
    const updater = fakeUpdater('0.11.0');
    const installer = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: true,
      e2eFeedUrl: 'http://127.0.0.1:8099/updates',
      loadUpdater: async () => updater,
    });
    await installer.apply(release);
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'http://127.0.0.1:8099/updates',
    });

    const prodInstaller = new UpdateInstaller({
      ...baseFor('linux'),
      isAppImage: true,
      loadUpdater: async () => updater,
    });
    await prodInstaller.apply(release);
    expect(updater.setFeedURL).toHaveBeenCalledTimes(1);
  });
});
