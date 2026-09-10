import { describe, expect, it, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, utimes, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  AppDiscoveryService,
  parseDesktopEntry,
  launchSpecFor,
} from '@main/services/AppDiscoveryService';

let dataDir: string;

afterAll(async () => {
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

async function makeFixtureDir(): Promise<string> {
  if (!dataDir) {
    dataDir = await mkdtemp(join(tmpdir(), 'da-apps-'));
  }
  const dir = join(dataDir, Math.random().toString(36).slice(2));
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeService(overrides: ConstructorParameters<typeof AppDiscoveryService>[0] = {}) {
  return new AppDiscoveryService({ platform: 'linux', home: '/home/test', ...overrides });
}

describe('parseDesktopEntry', () => {
  it('parses application fields and ignores localized duplicates', () => {
    const fields = parseDesktopEntry(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Firefix',
        'Name[de]=Feuerfuchs',
        'Comment=Browse the web',
        'Exec=/usr/bin/firefix %u',
        'Icon=firefix',
        'Categories=Network;WebBrowser;',
        '',
        '[Desktop Action new-window]',
        'Name=New Window',
      ].join('\n')
    );
    expect(fields).toMatchObject({
      isApplication: true,
      name: 'Firefix',
      comment: 'Browse the web',
      icon: 'firefix',
      exec: '/usr/bin/firefix %u',
    });
    expect(fields.categories).toEqual(['Network', 'WebBrowser']);
  });

  it('flags NoDisplay and Hidden and non-Application types', () => {
    expect(parseDesktopEntry('[Desktop Entry]\nType=Application\nNoDisplay=true\nName=x').noDisplay).toBe(true);
    expect(parseDesktopEntry('[Desktop Entry]\nType=Application\nHidden=true\nName=x').hidden).toBe(true);
    expect(parseDesktopEntry('[Desktop Entry]\nType=Link\nName=x\nURL=https://x').isApplication).toBe(false);
  });
});

describe('launchSpecFor', () => {
  it('maps platforms onto sanctioned launch mechanisms', () => {
    expect(launchSpecFor('linux', 'org.firefox', {})).toEqual({ type: 'gtk-launch', id: 'org.firefox' });
    expect(launchSpecFor('darwin', 'Safari', { bundlePath: '/Applications/Safari.app' })).toEqual({
      type: 'open-a',
      name: 'Safari',
      path: '/Applications/Safari.app',
    });
    expect(launchSpecFor('win32', 'Firefox', { execPath: 'C:\\x.lnk' })).toEqual({
      type: 'start',
      target: 'C:\\x.lnk',
    });
  });
});

describe('AppDiscoveryService.scan', () => {
  it('scans fixture roots, filters NoDisplay/Hidden and dedupes first-wins', async () => {
    const userDir = await makeFixtureDir();
    const systemDir = await makeFixtureDir();
    await writeFile(
      join(userDir, 'org.firefix.desktop'),
      '[Desktop Entry]\nType=Application\nName=Firefix\nIcon=firefix\nExec=firefix\n'
    );
    await writeFile(
      join(systemDir, 'org.firefix.desktop'),
      '[Desktop Entry]\nType=Application\nName=Duplicate\nExec=firefix\n'
    );
    await writeFile(
      join(systemDir, 'hidden.desktop'),
      '[Desktop Entry]\nType=Application\nName=Hidden\nNoDisplay=true\nExec=x\n'
    );
    await writeFile(
      join(systemDir, 'link.desktop'),
      '[Desktop Entry]\nType=Link\nName=Not an app\nURL=https://x\n'
    );
    const service = makeService({ roots: [userDir, systemDir] });
    const apps = await service.scan(true);
    expect(apps.map((app) => app.id)).toEqual(['org.firefix']);
    expect(apps[0]?.title).toBe('Firefix');
    expect(apps[0]?.launchSpec).toEqual({ type: 'gtk-launch', id: 'org.firefix' });
  });

  it('caches by dir mtimes and rescans only on change or force', async () => {
    const dir = await makeFixtureDir();
    await writeFile(
      join(dir, 'a.desktop'),
      '[Desktop Entry]\nType=Application\nName=Alpha\nExec=alpha\n'
    );
    let reads = 0;
    const service = makeService({
      roots: [dir],
      readTextFile: async (path) => {
        reads += 1;
        return await readFile(path, 'utf-8');
      },
    });
    await service.scan(false);
    expect(reads).toBe(1);
    await service.scan(false);
    expect(reads).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(
      join(dir, 'b.desktop'),
      '[Desktop Entry]\nType=Application\nName=Beta\nExec=beta\n'
    );
    const now = new Date();
    await utimes(dir, now, now);
    const apps = await service.scan(false);
    expect(reads).toBe(3);
    expect(apps.map((app) => app.id).sort()).toEqual(['a', 'b']);
    const forced = await service.scan(true);
    expect(forced).toHaveLength(2);
  });

  it('launches through the per-platform mechanism and rejects unknown ids', async () => {
    const dir = await makeFixtureDir();
    await writeFile(
      join(dir, 'firefix.desktop'),
      '[Desktop Entry]\nType=Application\nName=Firefix\nExec=firefix\n'
    );
    const calls: Array<{ file: string; args: string[] }> = [];
    const service = makeService({
      platform: 'linux',
      roots: [dir],
      launcher: async (file, args) => {
        calls.push({ file, args });
      },
    });
    await service.scan(true);
    await service.launch('firefix');
    expect(calls).toEqual([{ file: 'gtk-launch', args: ['firefix'] }]);
    await expect(service.launch('nope')).rejects.toThrow(/Unknown app/);
  });

  it('launches macOS bundles via open -a and Windows targets via start', async () => {
    const bundleRoot = await makeFixtureDir();
    const bundle = join(bundleRoot, 'Safari.app');
    await mkdir(bundle, { recursive: true });
    const calls: Array<{ file: string; args: string[] }> = [];
    const macService = makeService({
      platform: 'darwin',
      roots: [bundleRoot],
      launcher: async (file, args) => {
        calls.push({ file, args });
      },
    });
    await macService.scan(true);
    await macService.launch('Safari');
    expect(calls[0]).toEqual({ file: 'open', args: ['-a', 'Safari'] });

    const lnkRoot = await makeFixtureDir();
    await writeFile(join(lnkRoot, 'Firefox.lnk'), 'lnk');
    const winService = makeService({
      platform: 'win32',
      roots: [lnkRoot],
      launcher: async (file, args) => {
        calls.push({ file, args });
      },
    });
    await winService.scan(true);
    await winService.launch('Firefox');
    expect(calls.at(-1)?.file).toBe('cmd');
  });

  it('scans .app bundles with plist metadata', async () => {
    const root = await makeFixtureDir();
    const bundle = join(root, 'Safari.app', 'Contents');
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, 'Info.plist'),
      '<?xml version="1.0"?><plist><dict><key>CFBundleDisplayName</key><string>Safari</string><key>CFBundleIconFile</key><string>internet</string></dict></plist>'
    );
    const service = makeService({ platform: 'darwin' });
    const apps = await service.scanBundles([root]);
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ id: 'Safari', title: 'Safari', iconRef: 'internet' });
    expect(apps[0]?.launchSpec.type).toBe('open-a');
  });

  it('scans Start Menu .lnk trees with case-insensitive dedupe', async () => {
    const root = await makeFixtureDir();
    await writeFile(join(root, 'Firefox.lnk'), 'lnk');
    const nested = join(root, 'Accessories');
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, 'Paint.lnk'), 'lnk');
    const root2 = await makeFixtureDir();
    await writeFile(join(root2, 'firefox.lnk'), 'lnk');
    const service = makeService({ platform: 'win32' });
    const apps = await service.scanStartMenu([root, root2]);
    expect(apps.map((app) => app.id).sort()).toEqual(['Firefox', 'Paint']);
  });
});

describe('AppDiscoveryService.iconDataUrl', () => {
  it('returns raster data-URLs for absolute icon paths and rejects SVG', async () => {
    const dir = await makeFixtureDir();
    const pngPath = join(dir, 'icon.png');
    const svgPath = join(dir, 'icon.svg');
    await writeFile(pngPath, PNG_1PX);
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const service = makeService();
    const pngApp = { id: 'a', title: 'A', launchSpec: launchSpecFor('linux', 'a', {}), iconRef: pngPath };
    const svgApp = { id: 'b', title: 'B', launchSpec: launchSpecFor('linux', 'b', {}), iconRef: svgPath };
    expect(await service.iconDataUrl(pngApp)).toMatch(/^data:image\/png;base64,/);
    expect(await service.iconDataUrl(svgApp)).toBeNull();
  });

  it('resolves named icons through the hicolor theme then pixmaps', async () => {
    const themeDir = await makeFixtureDir();
    const pixmapsParent = await makeFixtureDir();
    const pixmapsDir = join(pixmapsParent, 'pixmaps');
    await mkdir(pixmapsDir, { recursive: true });
    const appsDir = join(themeDir, '48x48', 'apps');
    await mkdir(appsDir, { recursive: true });
    await writeFile(join(appsDir, 'firefix.png'), PNG_1PX);
    await writeFile(join(pixmapsDir, 'fallback.png'), PNG_1PX);
    const service = makeService({ iconDirs: [themeDir, pixmapsDir] });
    const named = { id: 'a', title: 'A', launchSpec: launchSpecFor('linux', 'a', {}), iconRef: 'firefix' };
    const fallback = { id: 'b', title: 'B', launchSpec: launchSpecFor('linux', 'b', {}), iconRef: 'fallback' };
    const missing = { id: 'c', title: 'C', launchSpec: launchSpecFor('linux', 'c', {}), iconRef: 'nope' };
    expect(await service.iconDataUrl(named)).toMatch(/^data:image\/png;base64,/);
    expect(await service.iconDataUrl(fallback)).toMatch(/^data:image\/png;base64,/);
    expect(await service.iconDataUrl(missing)).toBeNull();
  });
});
