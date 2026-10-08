import { basename, join, posix, sep } from 'path';
import { globToRegex, matchesGlob } from '@main/ai/tools/native/file-search';
import {
  PACK_LIMITS,
  PACK_REFUSED_ROOTS_EXACT,
  PACK_REFUSED_ROOTS_PREFIX,
  type PackError,
} from '@shared/app-pack';

/** Host environment facts the refusal rules expand against (injected for tests). */
export interface PackFsEnv {
  home: string;
  userData: string;
  platform: 'linux' | 'darwin' | 'win32';
  systemRoot?: string;
  programFiles?: string;
  programData?: string;
}

export interface PackStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  dev: number;
  size: number;
  mtimeMs: number;
}

export interface PackDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/** Every filesystem touch is injected — packs hold no OS handles, tests hold no real fs. */
export interface PackFsDeps {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<PackStat>;
  readdir(path: string): Promise<PackDirEntry[]>;
  readFileHead(path: string, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }>;
}

export type FsResult<T> = { ok: true; value: T } | { ok: false; error: PackError };

export interface PackScanItem {
  absolute: string;
  relative: string;
  size: number;
  mtimeMs: number;
}

export interface PackScanBudget {
  files: number;
  truncated: boolean;
  deadline: number;
}

const WINDOWS_DRIVE_ROOT = /^[a-zA-Z]:[\\/]?$/;
const LINUX_REFUSED_PREFIXES = ['/proc', '/sys', '/dev', '/run', '/boot', '/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/var', '/tmp'];
const DARWIN_REFUSED_PREFIXES = ['/System', '/Library', '/private'];
const DARWIN_REFUSED_EXACT = ['/mnt', '/media'];

function normalizeForCompare(path: string, platform: PackFsEnv['platform']): string {
  const unified = platform === 'win32' ? path.replace(/\\/g, '/').replace(/\/+$/, '') : path.replace(/\/+$/, '');
  return platform === 'linux' ? unified : unified.toLowerCase();
}

function refusedLists(env: PackFsEnv): { exact: string[]; prefixes: string[] } {
  const exact = new Set<string>(['/', env.home, env.userData, '/mnt', '/media']);
  const prefixes = new Set<string>();
  for (const token of PACK_REFUSED_ROOTS_EXACT) {
    if (token === '$HOME' || token === '$USERDATA') {
      continue;
    }
    if (token !== 'windows-drive-roots' && !token.startsWith('$')) {
      exact.add(token);
    }
  }
  for (const token of PACK_REFUSED_ROOTS_PREFIX) {
    if (token === '$SYSTEMROOT' && env.systemRoot) {
      prefixes.add(env.systemRoot);
    } else if (token === '$PROGRAMFILES' && env.programFiles) {
      prefixes.add(env.programFiles);
    } else if (token === '$PROGRAMDATA' && env.programData) {
      prefixes.add(env.programData);
    } else if (!token.startsWith('$')) {
      prefixes.add(token);
    }
  }
  if (env.platform === 'linux') {
    LINUX_REFUSED_PREFIXES.forEach((prefix) => prefixes.add(prefix));
  }
  if (env.platform === 'darwin') {
    DARWIN_REFUSED_PREFIXES.forEach((prefix) => prefixes.add(prefix));
    DARWIN_REFUSED_EXACT.forEach((entry) => exact.add(entry));
  }
  return {
    exact: [...exact].map((path) => normalizeForCompare(path, env.platform)),
    prefixes: [...prefixes].map((path) => normalizeForCompare(path, env.platform)),
  };
}

function pathDenied(reason: string, detail: Record<string, unknown> = {}): { ok: false; error: PackError } {
  return { ok: false, error: { code: 'path-denied', detail: { reason, ...detail } } };
}

function ioError(error: unknown): { ok: false; error: PackError } {
  return { ok: false, error: { code: 'io', detail: { reason: String((error as Error)?.message ?? error).slice(0, 300) } } };
}

/** Lexical safety: no empty, no NUL, no `..` segments, no absolute-path injection. */
export function isLexicallySafeRelative(relative: string): boolean {
  if (relative.length === 0 || relative.includes('\0')) {
    return false;
  }
  const segments = relative.split(/[/\\]/);
  return segments.every((segment) => segment !== '..' && segment.length > 0);
}

export function isLexicallySafeRootCandidate(path: string): boolean {
  if (path.length === 0 || path.includes('\0')) {
    return false;
  }
  const segments = path.split(/[/\\]/).filter((segment) => segment.length > 0);
  return segments.every((segment) => segment !== '..');
}

/**
 * Run-root validation (contract `fs.rootValidation`): resolve to the real
 * path FIRST, then refuse system/broad roots on the resolved path and
 * require a real directory. Containment is always enforced in resolved
 * space, so a symlinked root can only ever widen to its own real target —
 * which the refusal rules still vet.
 */
export async function validateRunRoot(
  requested: string,
  env: PackFsEnv,
  deps: PackFsDeps
): Promise<FsResult<{ root: string; dev: number }>> {
  if (!isLexicallySafeRootCandidate(requested)) {
    return pathDenied('lexically unsafe run root');
  }
  const { exact, prefixes } = refusedLists(env);
  const refused = (candidate: string): boolean =>
    exact.includes(candidate) || prefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`));
  if (WINDOWS_DRIVE_ROOT.test(requested)) {
    return pathDenied('drive roots are never run roots', { path: requested });
  }
  if (refused(normalizeForCompare(requested, env.platform))) {
    return pathDenied('refused run root (system or broad root)', { path: requested });
  }
  let resolved: string;
  try {
    resolved = await deps.realpath(requested);
  } catch (error) {
    return ioError(error);
  }
  const candidate = normalizeForCompare(resolved, env.platform);
  if (WINDOWS_DRIVE_ROOT.test(resolved)) {
    return pathDenied('drive roots are never run roots', { path: resolved });
  }
  if (refused(candidate)) {
    return pathDenied('refused run root (system or broad root)', { path: resolved });
  }
  try {
    const stats = await deps.stat(resolved);
    if (!stats.isDirectory) {
      return pathDenied('run root must be a directory', { path: resolved });
    }
    return { ok: true, value: { root: resolved, dev: stats.dev } };
  } catch (error) {
    return ioError(error);
  }
}

/** Joins a relative path into the root, refusing lexical escapes; null when unsafe. */
export function joinWithinRoot(root: string, relative: string): string | null {
  if (!isLexicallySafeRelative(relative)) {
    return null;
  }
  return join(root, ...relative.split(/[/\\]/));
}

export interface PackScanOptions {
  includeHidden: boolean;
  excludeGlobs: string[];
  fileCap: number;
  maxDepth: number;
  rootDev: number;
}

export function newScanBudget(): PackScanBudget {
  return { files: 0, truncated: false, deadline: Date.now() + 30_000 };
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

/**
 * The pack walk (contract `fs.scanTraversal`): symlinks skipped, mount
 * points (st_dev change) skipped, regular files only — reusing the file
 * tools' glob semantics for pack excludeGlobs.
 */
export async function walkPackRoot(
  root: string,
  options: PackScanOptions,
  deps: PackFsDeps,
  budget: PackScanBudget,
  visit: (item: PackScanItem) => void | Promise<void>
): Promise<void> {
  const exclude = options.excludeGlobs.map((glob) => ({ regex: globToRegex(glob), hasSlash: glob.includes('/') }));
  const excluded = (relative: string): boolean =>
    exclude.length === 0 ? false : exclude.some((entry) => matchesGlob(relative, entry.regex, entry.hasSlash));
  const stack: { absolute: string; relative: string; depth: number }[] = [{ absolute: root, relative: '', depth: 0 }];
  const budgetSpent = (): boolean =>
    budget.truncated || budget.files >= options.fileCap || Date.now() > budget.deadline;
  while (stack.length > 0) {
    if (budgetSpent()) {
      budget.truncated = true;
      return;
    }
    const current = stack.pop() as { absolute: string; relative: string; depth: number };
    let entries: PackDirEntry[];
    try {
      entries = await deps.readdir(current.absolute);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (budgetSpent()) {
        budget.truncated = true;
        return;
      }
      if (entry.isSymbolicLink) {
        continue;
      }
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (!options.includeHidden && isHidden(entry.name)) {
        continue;
      }
      if (excluded(relative)) {
        continue;
      }
      const absolute = current.relative === '' && current.absolute === root
        ? join(root, entry.name)
        : join(current.absolute, entry.name);
      const childDepth = current.depth + 1;
      if (entry.isDirectory) {
        if (childDepth >= options.maxDepth) {
          continue;
        }
        try {
          const dirStats = await deps.stat(absolute);
          if (dirStats.dev !== options.rootDev) {
            continue;
          }
        } catch {
          continue;
        }
        stack.push({ absolute, relative, depth: childDepth });
      } else if (entry.isFile) {
        if (childDepth > options.maxDepth) {
          continue;
        }
        try {
          const fileStats = await deps.stat(absolute);
          budget.files += 1;
          await visit({ absolute, relative, size: fileStats.size, mtimeMs: fileStats.mtimeMs });
        } catch {
          continue;
        }
      }
    }
  }
}

/**
 * One host-enforced fs capability bound to a validated run root.
 * Every read re-resolves against the root — no check-then-act window.
 */
export class PackFs {
  constructor(
    private readonly root: string,
    private readonly rootDev: number,
    private readonly deps: PackFsDeps
  ) {}

  get rootPath(): string {
    return this.root;
  }

  private async assertWithin(absolute: string): Promise<FsResult<string>> {
    let resolved: string;
    try {
      resolved = await this.deps.realpath(absolute);
    } catch (error) {
      return ioError(error);
    }
    if (resolved !== this.root && !resolved.startsWith(this.root + sep) && !resolved.startsWith(`${this.root}/`)) {
      return pathDenied('path resolves outside the run root', { path: absolute, root: this.root });
    }
    return { ok: true, value: resolved };
  }

  /** Capped content excerpt (only valid when the pack declared sendsContent). */
  async readExcerpt(relative: string, capBytes: number): Promise<FsResult<{ buffer: Buffer; truncated: boolean }>> {
    const absolute = joinWithinRoot(this.root, relative);
    if (absolute === null) {
      return pathDenied('lexically unsafe path', { path: relative });
    }
    const within = await this.assertWithin(absolute);
    if (!within.ok) {
      return within;
    }
    try {
      const stats = await this.deps.stat(within.value);
      if (!stats.isFile) {
        return pathDenied('not a regular file', { path: relative });
      }
      if (stats.dev !== this.rootDev) {
        return pathDenied('cross-device path refused', { path: relative });
      }
      const cap = Math.max(1, Math.min(capBytes, PACK_LIMITS.contentExcerptMaxBytes));
      return { ok: true, value: await this.deps.readFileHead(within.value, cap) };
    } catch (error) {
      return ioError(error);
    }
  }

  /** Metadata for one item, re-validated against the root. */
  async statItem(relative: string): Promise<FsResult<PackStat>> {
    const absolute = joinWithinRoot(this.root, relative);
    if (absolute === null) {
      return pathDenied('lexically unsafe path', { path: relative });
    }
    const within = await this.assertWithin(absolute);
    if (!within.ok) {
      return within;
    }
    try {
      return { ok: true, value: await this.deps.stat(within.value) };
    } catch (error) {
      return ioError(error);
    }
  }

  scan(options: Omit<PackScanOptions, 'rootDev'>, budget: PackScanBudget, visit: (item: PackScanItem) => void | Promise<void>): Promise<void> {
    return walkPackRoot(this.root, { ...options, rootDev: this.rootDev }, this.deps, budget, visit);
  }
}

export function packFileName(relative: string): string {
  return basename(posix.normalize(relative.split(/[\\]/).join('/')));
}
