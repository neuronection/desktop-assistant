import { describe, expect, it, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  SandboxService,
  type SandboxCallRecord,
  type SandboxProcess,
  type SandboxRunRow,
  type SandboxSpawn,
  type SandboxSpawnOptions,
  type SandboxStore,
  type SandboxTarget,
} from '@main/apps/sandbox/SandboxService';
import type { SandboxStateStore } from '@main/apps/sandbox/capabilities';
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from '@shared/app-pack';

const CHILD_PATH = join(process.cwd(), 'src', 'main', 'resources', 'sandbox-child.cjs');

const base = (() => {
  const parent = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'sandbox-'));
})();

let spawned: ChildProcess[] = [];

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

interface PackFixture {
  dir: string;
  manifest: Record<string, unknown>;
  manifestDigest: string;
  contentDigest: string;
}

function digestTree(root: string): string {
  const digest = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      const relative = full.slice(root.length + 1);
      if (relative.split('/').includes('.git') || entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        if (entry.isDirectory()) {
          walk(full);
        }
        continue;
      }
      const stats = statSync(full);
      digest.update(relative);
      digest.update('\0');
      digest.update(String(stats.size));
      digest.update('\0');
      digest.update(readFileSync(full));
    }
  };
  walk(root);
  return digest.digest('hex');
}

function makePack(name: string, entrySource: string, manifestExtra: Record<string, unknown> = {}): PackFixture {
  const dir = join(base, name);
  mkdirSync(join(dir, 'code'), { recursive: true });
  const manifest = {
    apiVersion: 1,
    id: name,
    version: '1.0.0',
    kind: 'surface',
    capabilities: ['state', 'secrets', 'ui:chat-card'],
    i18n: { defaultLocale: 'en', locales: { en: { title: name } } },
    code: { entry: 'code/entry.js' },
    ...manifestExtra,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'code', 'entry.js'), entrySource);
  return {
    dir,
    manifest,
    manifestDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    contentDigest: digestTree(dir),
  };
}

const SPAWN_ENVS: Record<string, Record<string, string>>[] = [];

/** The vitest transport: a REAL node process with REAL stdio pipes (the child's stdio branch). */
const nodeSpawn: SandboxSpawn = (options: SandboxSpawnOptions) => {
  SPAWN_ENVS.push(options.env);
  const child = spawn(process.execPath, [...options.execArgv, options.modulePath, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  spawned.push(child);
  const listeners = new Set<(message: unknown) => void>();
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        break;
      }
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let doc: unknown = null;
      try {
        doc = JSON.parse(line);
      } catch {
        doc = null;
      }
      for (const listener of listeners) {
        listener(doc);
      }
    }
  });
  child.on('error', () => {
    child.kill('SIGKILL');
  });
  return {
    pid: child.pid ?? 0,
    send: (message) => {
      child.stdin?.write(JSON.stringify(message) + '\n');
    },
    onMessage: (listener) => {
      listeners.add(listener);
    },
    onExit: (listener) => {
      child.on('exit', (code) => listener(code));
    },
    kill: () => {
      child.kill('SIGKILL');
    },
  };
};

function memoryStore() {
  const runs: SandboxRunRow[] = [];
  const calls: SandboxCallRecord[] = [];
  const store: SandboxStore = {
    createRun: async (row) => {
      runs.push({ ...row });
    },
    closeRun: async (id, outcome, reason, finishedAt) => {
      const row = runs.find((entry) => entry.id === id);
      if (row) {
        row.outcome = outcome;
        row.reason = reason;
        row.finishedAt = finishedAt;
      }
    },
    openRuns: async () => runs.filter((row) => row.finishedAt === null).map((row) => ({ ...row })),
    appendCall: async (record) => {
      calls.push({ ...record });
    },
  };
  return { runs, calls, store };
}

function memoryStateStore(): SandboxStateStore {
  const data = new Map<string, Map<string, unknown>>();
  return {
    get: async (packId, key) => data.get(packId)?.get(key) ?? null,
    all: async (packId) => Object.fromEntries(data.get(packId)?.entries() ?? []),
    set: async (packId, key, value) => {
      if (!data.has(packId)) {
        data.set(packId, new Map());
      }
      data.get(packId)?.set(key, value);
    },
  };
}

function makeService(packs: PackFixture[], limits: Partial<SandboxLimits> = {}) {
  const { runs, calls, store } = memoryStore();
  const disabled: { packId: string; reason: string }[] = [];
  const targets = new Map<string, SandboxTarget>(
    packs.map((pack) => [
      pack.manifest.id as string,
      {
        packId: pack.manifest.id as string,
        manifest: pack.manifest,
        contentPath: pack.dir,
        manifestDigest: pack.manifestDigest,
        contentDigest: pack.contentDigest,
        config: {},
      } satisfies SandboxTarget,
    ])
  );
  const service = new SandboxService({
    spawn: nodeSpawn,
    childPath: () => CHILD_PATH,
    workdir: (packId) => {
      const dir = join(base, 'work', packId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    resolveTarget: (packId) => targets.get(packId) ?? null,
    selfDisable: async (packId, reason) => {
      disabled.push({ packId, reason });
    },
    store,
    stateStore: memoryStateStore(),
    secretGet: async () => null,
    limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, callTimeoutMs: 2500, spawnTimeoutMs: 8000, disposeTimeoutMs: 1500, maxConcurrent: 4, ...limits }),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { service, runs, calls, disabled };
}

const HEALTHY_ENTRY = `
handlers = {
  ping(input) { return { pong: input.args.value ?? null }; },
  async statemc(input) {
    await capability.stateSet('last', input.args.v);
    const back = await capability.stateGet('last');
    await capability.progress(50);
    capability.log('info', 'halfway');
    return { back, config: input.config, calls: 3 };
  },
  async trynet() {
    try {
      await capability.netFetch('https://example.invalid/');
      return { net: 'allowed' };
    } catch (error) {
      return { net: 'denied', code: error.code };
    }
  },
  async emit(input) {
    const accepted = await capability.itemsEmit(input.args.items);
    return { accepted };
  },
  async secrets(input) {
    try {
      const injectedAs = await capability.secretsNeed(input.args.slot);
      return { injectedAs };
    } catch (error) {
      return { code: error.code, retryable: error.retryable };
    }
  },
};
`;

const PROBE_ENTRY = `
const results = {};
results.require = typeof require;
results.process = typeof process;
results.fetch = typeof fetch;
results.WebSocket = typeof WebSocket;
results.Buffer = typeof Buffer;
results.setTimeout = typeof setTimeout;
results.globalFetch = typeof globalThis.fetch;
handlers = {
  async probe() {
    try {
      await import('node:fs');
      results.dynamicImport = 'allowed';
    } catch (error) {
      results.dynamicImport = 'denied:' + ((error && error.code) || (error && error.name) || 'unknown');
    }
    try {
      const hostFn = capability.stateGet.constructor;
      results.methodFnEscape = hostFn('return typeof process')();
    } catch {
      results.methodFnEscape = 'denied';
    }
    try {
      results.fnEscape = Function('return typeof process')();
    } catch {
      results.fnEscape = 'denied';
    }
    return results;
  },
};
`;

describe('sandbox spine (S1 — real processes, ADR-0030 clause 1)', () => {
  it('handshake + invoke round trip over a real sandboxed process', { timeout: 30_000 }, async () => {
    const pack = makePack('round-trip', HEALTHY_ENTRY);
    const { service, runs } = makeService([pack]);
    const outcome = await service.invoke('round-trip', 'ping', { value: 42 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.output).toEqual({ pong: 42 });
      expect(outcome.result.runId).toBeTruthy();
    }
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe('completed');
    expect(runs[0].finishedAt).not.toBeNull();
    expect(spawned.every((child) => child.exitCode !== null || child.killed)).toBe(true);
  });

  it('manifest digest drift never runs the content', { timeout: 30_000 }, async () => {
    const pack = makePack('drift-manifest', HEALTHY_ENTRY);
    const { service, disabled, runs } = makeService([pack]);
    writeFileSync(join(pack.dir, 'manifest.json'), JSON.stringify({ ...pack.manifest, version: '9.9.9' }, null, 2));
    const outcome = await service.invoke('drift-manifest', 'ping', {});
    expect(outcome).toMatchObject({ ok: false, fatal: true, outcome: 'digest-drift' });
    if (!outcome.ok && outcome.fatal) {
      expect(outcome.reason).toContain('digest');
    }
    expect(disabled).toEqual([{ packId: 'drift-manifest', reason: expect.stringContaining('digest') }]);
    expect(runs[0].outcome).toBe('digest-drift');
  });

  it('content digest drift (tampered entry bytes) never runs', { timeout: 30_000 }, async () => {
    const pack = makePack('drift-entry', HEALTHY_ENTRY);
    const { service, disabled } = makeService([pack]);
    writeFileSync(join(pack.dir, 'code', 'entry.js'), `${HEALTHY_ENTRY}\n// tampered`);
    const outcome = await service.invoke('drift-entry', 'ping', {});
    expect(outcome).toMatchObject({ ok: false, fatal: true, outcome: 'digest-drift' });
    expect(disabled).toHaveLength(1);
  });

  it('handshake identity mismatch is fatal for the pack, not the app', { timeout: 30_000 }, async () => {
    const pack = makePack('identity', HEALTHY_ENTRY);
    const other = makePack('identity-other', HEALTHY_ENTRY);
    const { service, disabled } = makeService([pack]);
    const pin = { packId: 'identity', manifest: pack.manifest, contentPath: other.dir, manifestDigest: other.manifestDigest, contentDigest: other.contentDigest, config: {} };
    const probe = new SandboxService({
      spawn: nodeSpawn,
      childPath: () => CHILD_PATH,
      workdir: (id) => {
        const dir = join(base, 'work', id);
        mkdirSync(dir, { recursive: true });
        return dir;
      },
      resolveTarget: () => pin,
      selfDisable: async (packId, reason) => {
        disabled.push({ packId, reason });
      },
      store: memoryStore().store,
      stateStore: memoryStateStore(),
      secretGet: async () => null,
      limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, spawnTimeoutMs: 8000 }),
      now: () => Date.now(),
      sha256: (input) => createHash('sha256').update(input).digest('hex'),
    });
    const outcome = await probe.invoke('identity', 'ping', {});
    expect(outcome).toMatchObject({ ok: false, fatal: true, outcome: 'identity' });
    expect(disabled[0].reason).toContain('identity mismatch');
  });

  it('a load-failed pack self-disables with the typed load reason', { timeout: 30_000 }, async () => {
    const pack = makePack('load-fail', 'this is not valid javascript ((((');
    const { service, disabled } = makeService([pack]);
    const outcome = await service.invoke('load-fail', 'ping', {});
    expect(outcome).toMatchObject({ ok: false, fatal: true, outcome: 'crashed' });
    expect(disabled[0].reason).toContain('failed to load');
  });

  it('infinite loop ⇒ watchdog kill + self-disable; another pack stays unaffected', { timeout: 40_000 }, async () => {
    const loop = makePack('loop-pack', 'handlers = { spin() { for (;;) {} } };');
    const healthy = makePack('healthy-pack', HEALTHY_ENTRY);
    const { service, disabled } = makeService([loop, healthy], { callTimeoutMs: 700 });
    const spinOutcome = await service.invoke('loop-pack', 'spin', {});
    expect(spinOutcome).toMatchObject({ ok: false, fatal: true, outcome: 'watchdog' });
    expect(disabled).toEqual([{ packId: 'loop-pack', reason: expect.stringContaining('watchdog') }]);
    const healthyOutcome = await service.invoke('healthy-pack', 'ping', { value: 'alive' });
    expect(healthyOutcome).toEqual({ ok: true, result: expect.objectContaining({ output: { pong: 'alive' } }) });
    expect(disabled).toHaveLength(1);
  });

  it('per-pack kill switch kills the live sandbox and cancels without self-disable', { timeout: 40_000 }, async () => {
    const pack = makePack('kill-pack', 'handlers = { spin() { for (;;) {} } };');
    const { service, disabled } = makeService([pack], { callTimeoutMs: 8000 });
    const pending = service.invoke('kill-pack', 'spin', {});
    for (let i = 0; i < 100 && service.livePacks().length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(service.killPack('kill-pack')).toBe(true);
    const outcome = await pending;
    expect(service.killPack('kill-pack')).toBe(false);
    expect(outcome).toMatchObject({ ok: false, fatal: false, error: { code: 'canceled' } });
    expect(disabled).toEqual([]);
  });

  it('the concurrent cap answers budget, never queues silently', { timeout: 40_000 }, async () => {
    const one = makePack('cap-one', 'handlers = { spin() { for (;;) {} } };');
    const two = makePack('cap-two', HEALTHY_ENTRY);
    const { service } = makeService([one, two], { maxConcurrent: 1, callTimeoutMs: 8000 });
    const first = service.invoke('cap-one', 'spin', {});
    for (let i = 0; i < 100 && service.livePacks().length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const second = await service.invoke('cap-two', 'ping', {});
    expect(second).toMatchObject({ ok: false, fatal: false, error: { code: 'budget' } });
    service.killPack('cap-one');
    await first;
  });

  it('boot reconciliation closes orphaned runs as interrupted — never pack failure', { timeout: 30_000 }, async () => {
    const pack = makePack('reconcile', HEALTHY_ENTRY);
    const { service, runs, disabled } = makeService([pack]);
    runs.push({
      id: 'orphan', packId: 'reconcile', digest: pack.manifestDigest, pid: 1, op: 'ping',
      outcome: 'completed', reason: null, startedAt: 0, updatedAt: 0, finishedAt: null,
    });
    expect(await service.reconcileBoot()).toBe(1);
    expect(runs[0].outcome).toBe('interrupted');
    expect(runs[0].finishedAt).not.toBeNull();
    expect(disabled).toEqual([]);
  });
});

describe('frozen module surface (S1 — the escape attempts are first-class tests)', () => {
  it('no DOM, no node builtins, no fetch, no dynamic import, no host escape', { timeout: 30_000 }, async () => {
    const pack = makePack('probe-pack', PROBE_ENTRY);
    const { service } = makeService([pack]);
    const outcome = await service.invoke('probe-pack', 'probe', {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    const results = outcome.result.output as Record<string, string>;
    expect(results.require).toBe('undefined');
    expect(results.process).toBe('undefined');
    expect(results.fetch).toBe('undefined');
    expect(results.WebSocket).toBe('undefined');
    expect(results.Buffer).toBe('undefined');
    expect(results.setTimeout).toBe('undefined');
    expect(results.globalFetch).toBe('undefined');
    expect(results.dynamicImport).toMatch(/^denied:/);
    expect(results.methodFnEscape).toBe('undefined');
    expect(results.fnEscape).toBe('undefined');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('the sandbox spawns with a scrubbed environment (no host env, HOME pinned to the workdir)', { timeout: 30_000 }, async () => {
    const pack = makePack('env-pack', HEALTHY_ENTRY);
    SPAWN_ENVS.length = 0;
    const { service } = makeService([pack]);
    await service.invoke('env-pack', 'ping', {});
    expect(SPAWN_ENVS).toHaveLength(1);
    const env = SPAWN_ENVS[0];
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
    expect(env.HOME).toContain(join('work', 'env-pack'));
  });

  it('the child recycles itself after repeated protocol garbage (real stdio process)', { timeout: 30_000 }, async () => {
    const pack = makePack('garbage', HEALTHY_ENTRY);
    const child = spawn(process.execPath, [
      CHILD_PATH,
      '--protocol', 'capability-rpc/1',
      '--content-dir', pack.dir,
      '--entry', 'code/entry.js',
      '--manifest-digest', pack.manifestDigest,
      '--content-digest', pack.contentDigest,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    child.stdin?.write('not json at all\n{{{\n"bare string"\n');
    expect(await exited).toBe(3);
    child.kill('SIGKILL');
  });
});
