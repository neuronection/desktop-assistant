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
  resolve(origin: string, ref: { strategy: string; value?: string }): Promise<ResolvedRef>;
  fetch(origin: string, resolved: ResolvedRef, dest: string, token?: string | null): Promise<void>;
  /** A fresh scratch root for one fetch (the caller fetches into <root>/tree and removes the root). */
  tempRoot(): Promise<string>;
}

const FETCH_TIMEOUT_MS = 30_000;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REF_NAME_RE = /^[A-Za-z0-9._/+*-]{1,200}$/;

/**
 * git subprocess transport (the career reference semantics): resolve via
 * `ls-remote`, then a CONSTRAINED shallow fetch. The executable is the
 * allowlisted `git` resolved once to an absolute path; every invocation
 * is an argv array (no shell, no interpolation — source-provided strings
 * can never become flags because each one is pattern-validated against
 * the vendored schema BEFORE any spawn). Credentials ride the
 * GIT_CONFIG_* environment, never argv.
 */
export class ChildGitTransport implements GitTransport {
  private gitPath: string | null = null;

  private async git(args: string[], cwd?: string, token?: string | null): Promise<string> {
    const executable = await this.executable();
    try {
      const { stdout } = await execFileAsync(executable, args, {
        cwd,
        timeout: FETCH_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: token
          ? {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GIT_CONFIG_COUNT: '1',
              GIT_CONFIG_KEY_0: 'http.extraHeader',
              GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
            }
          : { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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

  async resolve(origin: string, ref: { strategy: string; value?: string }): Promise<ResolvedRef> {
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
    const listing = await this.git(['ls-remote', origin]);
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
      await this.git(['init', '--quiet'], dest);
      await this.git(['remote', 'add', 'origin', origin], dest);
      await this.git(['fetch', '--quiet', '--depth', '1', 'origin', fetchRef], dest, token);
      await this.git(['checkout', '--quiet', 'FETCH_HEAD'], dest);
      return;
    }
    await this.git(['clone', '--quiet', '--depth', '1', '--branch', fetchRef, origin, dest], undefined, token);
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
