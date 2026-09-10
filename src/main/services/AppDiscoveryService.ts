import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import type { DiscoveredApp, AppLaunchSpec } from '@shared/commands';

const execFileAsync = promisify(execFile);

const ICON_MAX_BYTES = 512_000;
const RASTER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const HICOLOUR_SIZES = [256, 128, 96, 64, 48, 32];

export interface DesktopEntryFields {
  isApplication: boolean;
  name?: string;
  comment?: string;
  icon?: string;
  categories?: string[];
  exec?: string;
  noDisplay: boolean;
  hidden: boolean;
}

/** Parses an INI-style .desktop file body — pure and platform-independent. */
export function parseDesktopEntry(text: string): DesktopEntryFields {
  const fields: DesktopEntryFields = {
    isApplication: false,
    noDisplay: false,
    hidden: false,
  };
  let inMainSection = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[')) {
      inMainSection = line === '[Desktop Entry]';
      continue;
    }
    if (!inMainSection) {
      continue;
    }
    const equals = line.indexOf('=');
    if (equals <= 0) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    switch (key) {
      case 'Type':
        fields.isApplication = value === 'Application';
        break;
      case 'Name':
        fields.name ??= firstLocalized(value);
        break;
      case 'Comment':
        fields.comment ??= firstLocalized(value);
        break;
      case 'Icon':
        fields.icon ??= firstLocalized(value);
        break;
      case 'Categories':
        fields.categories = value.split(';').map((part) => part.trim()).filter(Boolean);
        break;
      case 'Exec':
        fields.exec = value;
        break;
      case 'NoDisplay':
        fields.noDisplay = value.toLowerCase() === 'true';
        break;
      case 'Hidden':
        fields.hidden = value.toLowerCase() === 'true';
        break;
      default:
        break;
    }
  }
  return fields;
}

function firstLocalized(value: string): string {
  return value.split(';')[0] ?? value;
}

export function launchSpecFor(platform: NodeJS.Platform, id: string, detail: { execPath?: string; bundlePath?: string }): AppLaunchSpec {
  if (platform === 'darwin') {
    return { type: 'open-a', name: id, path: detail.bundlePath ?? '' };
  }
  if (platform === 'win32') {
    return { type: 'start', target: detail.execPath ?? id };
  }
  return { type: 'gtk-launch', id };
}

export class AppDiscoveryService {
  private cache: { apps: DiscoveredApp[]; stamps: Map<string, number> } | null = null;
  private scanPromise: Promise<DiscoveredApp[]> | null = null;

  constructor(
    private readonly deps: {
      home?: string;
      platform?: NodeJS.Platform;
      launcher?: (file: string, args: string[]) => Promise<void>;
      readTextFile?: (path: string) => Promise<string>;
      readBinaryFile?: (path: string) => Promise<Buffer>;
      iconDirs?: string[];
      /** Overrides the per-OS scan roots (hermetic fixture tests). */
      roots?: string[];
    } = {}
  ) {}

  private get home(): string {
    return this.deps.home ?? process.env.HOME ?? '';
  }

  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  /** Directory mtimes decide freshness — installs/uninstalls bump the parent dir mtime. */
  private async dirStamps(dirs: string[]): Promise<Map<string, number>> {
    const stamps = new Map<string, number>();
    for (const dir of dirs) {
      const info = await stat(dir).catch(() => null);
      stamps.set(dir, info?.mtimeMs ?? -1);
    }
    return stamps;
  }

  async scan(force = false): Promise<DiscoveredApp[]> {
    const roots = this.scanRoots();
    if (!force && this.cache) {
      const stamps = await this.dirStamps(roots);
      const fresh = [...stamps.entries()].every(([dir, mtime]) => this.cache?.stamps.get(dir) === mtime);
      if (fresh) {
        return this.cache.apps;
      }
    }
    if (!this.scanPromise || force) {
      this.scanPromise = this.rescan(roots).finally(() => {
        this.scanPromise = null;
      });
    }
    return this.scanPromise;
  }

  async ensureWarm(): Promise<void> {
    await this.scan(false).catch(() => undefined);
  }

  /** Synchronous cache view for catalog assembly — empty until the first scan lands. */
  getApps(): DiscoveredApp[] {
    return this.cache?.apps ?? [];
  }

  /** Fixture override wins; otherwise the per-OS source roots. */
  private scanRoots(): string[] {
    if (this.deps.roots) {
      return this.deps.roots;
    }
    const platform = this.platform;
    if (platform === 'darwin') {
      return this.bundleRoots();
    }
    if (platform === 'win32') {
      return this.startMenuRoots();
    }
    return this.sourceDirs();
  }

  private async rescan(roots: string[]): Promise<DiscoveredApp[]> {
    const stamps = await this.dirStamps(roots);
    const platform = this.platform;
    let apps: DiscoveredApp[] = [];
    if (platform === 'darwin') {
      apps = await this.scanBundles(roots);
    } else if (platform === 'win32') {
      apps = await this.scanStartMenu(roots);
    } else {
      apps = await this.scanDesktopEntryDirs(roots);
    }
    const deduped = new Map<string, DiscoveredApp>();
    for (const app of apps) {
      if (!deduped.has(app.id)) {
        deduped.set(app.id, app);
      }
    }
    this.cache = { apps: [...deduped.values()], stamps };
    return this.cache.apps;
  }

  /** Linux: XDG data dirs + flatpak + snap desktop entries. */
  sourceDirs(): string[] {
    if (this.platform === 'darwin' || this.platform === 'win32') {
      return [];
    }
    const home = this.home;
    const dataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
    const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
      .split(':')
      .filter(Boolean)
      .map((dir) => (dir.startsWith('~') ? join(home, dir.slice(1)) : dir));
    return [
      join(dataHome, 'applications'),
      ...dataDirs.map((dir) => join(dir, 'applications')),
      '/var/lib/flatpak/exports/share/applications',
      join(home, '.local/share/flatpak/exports/share/applications'),
      '/var/lib/snapd/desktop/applications',
    ];
  }

  private bundleRoots(): string[] {
    const home = this.home;
    return ['/System/Applications', '/Applications', join(home, 'Applications')];
  }

  private startMenuRoots(): string[] {
    const home = this.home;
    return [
      join(process.env.PROGRAMDATA ?? join(home, '..', '..', 'ProgramData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];
  }

  async scanDesktopEntryDirs(dirs: string[]): Promise<DiscoveredApp[]> {
    const readText = this.deps.readTextFile ?? (async (path) => await readFile(path, 'utf-8'));
    const apps: DiscoveredApp[] = [];
    for (const dir of dirs) {
      const files = await readdir(dir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith('.desktop')) {
          continue;
        }
        const text = await readText(join(dir, file)).catch(() => null);
        if (text === null) {
          continue;
        }
        const fields = parseDesktopEntry(text);
        if (!fields.isApplication || fields.noDisplay || fields.hidden || !fields.name) {
          continue;
        }
        apps.push({
          id: basename(file, '.desktop'),
          title: fields.name,
          comment: fields.comment,
          categories: fields.categories,
          iconRef: fields.icon,
          launchSpec: launchSpecFor(this.platform, basename(file, '.desktop'), { execPath: fields.exec }),
          keywords: fields.categories,
        });
      }
    }
    return apps;
  }

  async scanBundles(roots: string[]): Promise<DiscoveredApp[]> {
    const readText = this.deps.readTextFile ?? (async (path) => await readFile(path, 'utf-8'));
    const apps: DiscoveredApp[] = [];
    for (const root of roots) {
      const bundles = await readdir(root).catch(() => []);
      for (const bundle of bundles) {
        if (!bundle.endsWith('.app')) {
          continue;
        }
        const name = basename(bundle, '.app');
        const bundlePath = join(root, bundle);
        const plist = await readText(join(bundlePath, 'Contents', 'Info.plist')).catch(() => null);
        const displayName = plist ? extractPlistString(plist, 'CFBundleDisplayName') ?? extractPlistString(plist, 'CFBundleName') : null;
        const iconRef = plist ? extractPlistString(plist, 'CFBundleIconFile') ?? undefined : undefined;
        apps.push({
          id: name,
          title: displayName ?? name,
          iconRef,
          launchSpec: launchSpecFor(this.platform, name, { bundlePath }),
          keywords: undefined,
        });
      }
    }
    return apps;
  }

  async scanStartMenu(roots: string[]): Promise<DiscoveredApp[]> {
    const apps: DiscoveredApp[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      const links = await walkForLinks(root, 4);
      for (const link of links) {
        const title = basename(link, '.lnk');
        const key = title.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        apps.push({
          id: title,
          title,
          launchSpec: launchSpecFor(this.platform, title, { execPath: link }),
          keywords: undefined,
        });
      }
    }
    return apps;
  }

  async launch(id: string): Promise<void> {
    const apps = await this.scan(false);
    const app = apps.find((candidate) => candidate.id === id);
    if (!app) {
      throw new Error(`Unknown app '${id}'.`);
    }
    const launcher = this.deps.launcher ?? (async (file, args) => {
      await execFileAsync(file, args, { timeout: 15_000, windowsVerbatimArguments: process.platform === 'win32' });
    });
    const spec = app.launchSpec;
    if (spec.type === 'gtk-launch') {
      await launcher('gtk-launch', [spec.id]);
      return;
    }
    if (spec.type === 'open-a') {
      await launcher('open', ['-a', spec.name]);
      return;
    }
    await launcher('cmd', ['/c', 'start', '', spec.target]);
  }

  /**
   * Icon pipeline (plan 14 D7): absolute `Icon=` paths and hicolor hits
   * become raster-only data-URLs — SVG/XPM are rejected at this seam
   * (script-vector risk); missing icons return null so the renderer
   * falls back to the deterministic monogram tile.
   */
  async iconDataUrl(app: DiscoveredApp): Promise<string | null> {
    const readBinary = this.deps.readBinaryFile ?? (async (path) => await readFile(path));
    const ref = app.iconRef;
    if (!ref) {
      return null;
    }
    const candidates: string[] = [];
    if (ref.startsWith('/')) {
      candidates.push(ref);
    } else {
      const dirs = this.deps.iconDirs ?? ['/usr/share/icons/hicolor', '/usr/share/pixmaps'];
      for (const dir of dirs) {
        if (dir.endsWith('pixmaps')) {
          candidates.push(join(dir, `${ref}.png`));
          continue;
        }
        for (const size of HICOLOUR_SIZES) {
          candidates.push(join(dir, `${size}x${size}`, 'apps', `${ref}.png`));
        }
        candidates.push(join(dir, 'scalable', 'apps', `${ref}.svg`));
      }
    }
    for (const candidate of candidates) {
      const mime = RASTER_MIME[extname(candidate).toLowerCase()];
      if (!mime) {
        continue;
      }
      const bytes = await readBinary(candidate).catch(() => null);
      if (!bytes || bytes.length === 0 || bytes.length > ICON_MAX_BYTES) {
        continue;
      }
      return `data:${mime};base64,${bytes.toString('base64')}`;
    }
    return null;
  }
}

function extractPlistString(plist: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(plist);
  return match?.[1] ?? null;
}

async function walkForLinks(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop() as { dir: string; depth: number };
    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      const absolute = join(current.dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
        found.push(absolute);
      } else if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ dir: absolute, depth: current.depth + 1 });
      }
    }
  }
  return found;
}
