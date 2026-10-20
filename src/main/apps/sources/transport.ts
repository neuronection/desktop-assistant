import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ResolvedRef {
  /** The pin identity: the tag NAME for tag strategies, the commit sha otherwise. */
  ref: string;
  sha: string;
  /** What git can fetch (tag/branch name or sha); defaults to ref. */
  fetchRef: string;
}

export class GitTransportError extends Error {
  constructor(
    readonly code: 'unreachable' | 'not-found' | 'invalid' | 'path-denied' | 'io',
    message: string
  ) {
    super(message);
  }
}

export interface GitTransport {
  resolve(origin: string, ref: { strategy: string; value?: string }, token?: string | null): Promise<ResolvedRef>;
  fetch(origin: string, resolved: ResolvedRef, dest: string, token?: string | null): Promise<void>;
  /** A fresh scratch root for one fetch (the caller fetches into <root>/tree and removes the root). */
  tempRoot(): Promise<string>;
}

const FETCH_TIMEOUT_MS = 30_000;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_NAME_RE = /^[A-Za-z0-9._/+*-]{1,200}$/;

/**
 * The child environment is an ALLOWLIST, never `...process.env` (F24):
 * a hostile host env must not be able to inject a transport command, a
 * linker preload, an ssh proxy or a git config redirect into the fetch.
 * Every `GIT_*`, `LD_*` and `DYLD_*` variable is therefore absent by
 * construction — notably `GIT_SSH_COMMAND`, `GIT_PROXY_COMMAND`,
 * `GIT_DIR`, `GIT_CONFIG_*` and `LD_PRELOAD` — and host git config is
 * switched off (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL` → the null
 * device) so `core.sshCommand`, credential helpers, proxies and
 * `url.*.insteadOf` cannot ride in from the user's dotfiles either.
 */
const GIT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const;

/**
 * The one git child env (F24b — the SAME posture for `ls-remote` and
 * `fetch`). A credential rides env-scoped config, never argv, and only
 * under a URL-scoped key (`http.<origin>.extraHeader`) so it is bound to
 * the source's own origin. With a bearer we also set
 * `http.followRedirects=false`: git has no "same host only" redirect
 * policy, so the fail-closed answer is no redirects at all — the bearer
 * can never be replayed at another host.
 */
export function gitChildEnv(
  token: string | null | undefined,
  origin: string,
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of GIT_ENV_ALLOWLIST) {
    const value = base[key];
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value;
    }
  }
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  if (!token) {
    return env;
  }
  env.GIT_CONFIG_COUNT = '2';
  env.GIT_CONFIG_KEY_0 = `http.${gitHttpScope(origin)}.extraHeader`;
  env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${token}`;
  env.GIT_CONFIG_KEY_1 = 'http.followRedirects';
  env.GIT_CONFIG_VALUE_1 = 'false';
  return env;
}

/** `https://host/` — the binding scope for the bearer header (never a path, never a wildcard). */
function gitHttpScope(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new GitTransportError('invalid', 'credentials require a parseable https source URL');
  }
  if (url.protocol !== 'https:') {
    throw new GitTransportError('invalid', 'credentials require an https source URL');
  }
  return `${url.protocol}//${url.host}/`;
}

/**
 * git subprocess transport (the career reference semantics): resolve via
 * `ls-remote`, then a CONSTRAINED shallow fetch. The executable is the
 * allowlisted `git` resolved once to an absolute path; every invocation
 * is an argv array (no shell, no interpolation — source-provided strings
 * can never become flags because each one is pattern-validated against
 * the vendored schema BEFORE any spawn). Credentials ride the
 * GIT_CONFIG_* environment, never argv, through `gitChildEnv` (F24).
 */
export class ChildGitTransport implements GitTransport {
  private gitPath: string | null = null;

  private async git(args: string[], options: { cwd?: string; origin?: string; token?: string | null } = {}): Promise<string> {
    const executable = await this.executable();
    try {
      const { stdout } = await execFileAsync(executable, args, {
        cwd: options.cwd,
        timeout: FETCH_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: gitChildEnv(options.token ?? null, options.origin ?? ''),
      });
      return stdout;
    } catch (error) {
      const err = error as { code?: string | number; killed?: boolean; message?: string };
      if (err.killed) {
        throw new GitTransportError('unreachable', `git ${args[0]} timed out`);
      }
      const message = (err.message ?? '').split('\n').filter(Boolean).pop() ?? 'unknown git failure';
      if (/not found|does not point to a valid|couldn't find remote ref/i.test(message)) {
        throw new GitTransportError('not-found', message);
      }
      throw new GitTransportError('unreachable', message);
    }
  }

  private async executable(): Promise<string> {
    if (this.gitPath) {
      return this.gitPath;
    }
    try {
      const probe = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(probe, [process.platform === 'win32' ? 'git.exe' : 'git']);
      const resolved = stdout.trim().split('\n')[0]?.trim();
      if (!resolved) {
        throw new Error('empty which output');
      }
      this.gitPath = resolved;
      return resolved;
    } catch {
      throw new GitTransportError('io', 'the git executable is not available on this machine — git sources are unavailable');
    }
  }

  async resolve(origin: string, ref: { strategy: string; value?: string }, token?: string | null): Promise<ResolvedRef> {
    const strategy = ref.strategy;
    const value = ref.value ?? '';
    if (strategy === 'commit-pin') {
      if (!SHA_RE.test(value)) {
        throw new GitTransportError('invalid', 'commit-pin requires a 40- or 64-hex sha');
      }
      return { ref: value, sha: value, fetchRef: value };
    }
    if (value !== '' && !REF_NAME_RE.test(value)) {
      throw new GitTransportError('invalid', `ref name is not fetchable: ${JSON.stringify(value)}`);
    }
    // A private source authenticates discovery exactly like the fetch (F24b).
    const listing = await this.git(['ls-remote', origin], { origin, token });
    const refs = new Map<string, string>();
    for (const line of listing.split('\n')) {
      const [sha, name] = line.split('\t');
      if (!sha || !name || name.endsWith('^{}')) {
        continue;
      }
      refs.set(name.trim(), sha.trim());
    }
    if (strategy === 'branch') {
      const head = refs.get(`refs/heads/${value}`);
      if (!head) {
        throw new GitTransportError('not-found', `branch '${value}' not found on the source`);
      }
      return { ref: head, sha: head, fetchRef: value };
    }
    const tags = new Map<string, string>();
    for (const [name, sha] of refs) {
      if (name.startsWith('refs/tags/')) {
        tags.set(name.slice('refs/tags/'.length), sha);
      }
    }
    const matching = new Map<string, string>();
    for (const [tag, sha] of tags) {
      if (strategy === 'release-tag' || (strategy === 'tag-pattern' && matchesGlob(tag, value))) {
        matching.set(tag, sha);
      }
    }
    const latest = latestTag([...matching.keys()]);
    if (!latest) {
      throw new GitTransportError('not-found', `no release tag matching ${strategy} ${JSON.stringify(value)} on the source`);
    }
    return { ref: latest, sha: matching.get(latest) as string, fetchRef: latest };
  }

  async fetch(origin: string, resolved: ResolvedRef, dest: string, token?: string | null): Promise<void> {
    const fetchRef = resolved.fetchRef || resolved.ref;
    if (SHA_RE.test(fetchRef)) {
      await this.git(['init', '--quiet'], { cwd: dest });
      await this.git(['remote', 'add', 'origin', origin], { cwd: dest });
      await this.git(['fetch', '--quiet', '--depth', '1', 'origin', fetchRef], { cwd: dest, origin, token });
      await this.git(['checkout', '--quiet', 'FETCH_HEAD'], { cwd: dest });
      return;
    }
    await this.git(['clone', '--quiet', '--depth', '1', '--branch', fetchRef, origin, dest], { origin, token });
  }

  /** A fresh scratch root for one fetch (the caller fetches into <root>/tree). */
  tempRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'da-ext-src-'));
  }
}

/** Highest semver tag; name-descending fallback for non-semver tags (career parity). */
export function latestTag(tags: string[]): string | null {
  if (tags.length === 0) {
    return null;
  }
  const key = (tag: string): [number, [number, number, number], string] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(tag);
    if (!match) {
      return [0, [0, 0, 0], tag];
    }
    return [1, [Number(match[1]), Number(match[2]), Number(match[3])], tag];
  };
  return tags.reduce((best, tag) => {
    const [bestMajor, bestSem, bestName] = key(best);
    const [major, sem, name] = key(tag);
    if (major !== bestMajor) return major > bestMajor ? tag : best;
    if (sem[0] !== bestSem[0]) return sem[0] > bestSem[0] ? tag : best;
    if (sem[1] !== bestSem[1]) return sem[1] > bestSem[1] ? tag : best;
    if (sem[2] !== bestSem[2]) return sem[2] > bestSem[2] ? tag : best;
    return name > bestName ? tag : best;
  });
}

/** Bounded glob (the tag-pattern vocabulary: `*` only, schema-validated). */
function matchesGlob(tag: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[A-Za-z0-9._-]*');
  return new RegExp(`^${escaped}$`).test(tag);
}
