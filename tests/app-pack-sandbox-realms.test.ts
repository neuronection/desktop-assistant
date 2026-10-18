import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SandboxService, type SandboxCallRecord, type SandboxRunRow, type SandboxSpawn, type SandboxSpawnOptions, type SandboxStore, type SandboxTarget } from '@main/apps/sandbox/SandboxService';
import { resetSandboxQuotaState, type SandboxStateStore } from '@main/apps/sandbox/capabilities';
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from '@shared/app-pack';

const CHILD_SOURCE = join(process.cwd(), 'src', 'main', 'resources', 'sandbox-child.cjs');

const base = (() => {
  const parent = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'sandbox-realms-'));
})();

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  resetSandboxQuotaState();
});

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

interface PackFixture {
  name: string;
  dir: string;
  manifest: Record<string, unknown>;
  manifestDigest: string;
  contentDigest: string;
}

function makePack(name: string, entrySource: string): PackFixture {
  const dir = join(base, name);
  mkdirSync(join(dir, 'code'), { recursive: true });
  const manifest = {
    apiVersion: 1,
    id: name,
    version: '1.0.0',
    kind: 'surface',
    capabilities: ['state'],
    i18n: { defaultLocale: 'en', locales: { en: { title: name } } },
    code: { entry: 'code/entry.js' },
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'code', 'entry.js'), entrySource);
  return {
    name,
    dir,
    manifest,
    manifestDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    contentDigest: digestTree(dir),
  };
}

const nodeSpawn: SandboxSpawn = (options: SandboxSpawnOptions) => {
  const child = spawn(process.execPath, [...options.execArgv, options.modulePath, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const listeners = new Set<(message: unknown) => void>();
  let buffer = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let doc: unknown = null;
      try {
        doc = JSON.parse(line);
      } catch {
        doc = null;
      }
      for (const listener of listeners) listener(doc);
    }
  });
  child.on('error', () => child.kill('SIGKILL'));
  return {
    pid: child.pid ?? 0,
    send: (message) => child.stdin?.write(JSON.stringify(message) + '\n'),
    onMessage: (listener) => listeners.add(listener),
    onExit: (listener) => child.on('exit', (code) => listener(code)),
    kill: () => child.kill('SIGKILL'),
  };
};

function makeService(packs: PackFixture[], limits: Partial<SandboxLimits> = {}) {
  const runs: SandboxRunRow[] = [];
  const calls: SandboxCallRecord[] = [];
  const store: SandboxStore = {
    createRun: async (row) => runs.push({ ...row }),
    closeRun: async (id, outcome, reason, finishedAt) => {
      const row = runs.find((entry) => entry.id === id);
      if (row) {
        row.outcome = outcome;
        row.reason = reason;
        row.finishedAt = finishedAt;
      }
    },
    openRuns: async () => runs.filter((row) => row.finishedAt === null),
    appendCall: async (record) => calls.push({ ...record }),
  };
  const stateData = new Map<string, Map<string, unknown>>();
  const stateStore: SandboxStateStore = {
    get: async (packId, key) => stateData.get(packId)?.get(key) ?? null,
    all: async (packId) => Object.fromEntries(stateData.get(packId)?.entries() ?? []),
    set: async (packId, key, value) => {
      if (!stateData.has(packId)) stateData.set(packId, new Map());
      stateData.get(packId)?.set(key, value);
    },
  };
  const targets = new Map<string, SandboxTarget>(
    packs.map((pack) => [
      pack.manifest.id as string,
      { packId: pack.manifest.id as string, manifest: pack.manifest, contentPath: pack.dir, manifestDigest: pack.manifestDigest, contentDigest: pack.contentDigest, config: {} } satisfies SandboxTarget,
    ])
  );
  const disabled: { packId: string; reason: string }[] = [];
  const service = new SandboxService({
    spawn: nodeSpawn,
    childPath: () => CHILD_SOURCE,
    workdir: (packId) => {
      const dir = join(base, 'work', packId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    resolveTarget: (packId) => targets.get(packId) ?? null,
    selfDisable: async (packId, reason) => disabled.push({ packId, reason }),
    store,
    stateStore,
    secretGet: async () => null,
    limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, callTimeoutMs: 5000, spawnTimeoutMs: 8000, disposeTimeoutMs: 1500, ...limits }),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { service, runs, calls, disabled, stateData };
}

const ESCAPE_PACK = `handlers = {
  async escapeinput(input) {
    try {
      const F = input.constructor.constructor;
      return { via: 'input', processType: F('return typeof process')() };
    } catch (error) {
      return { via: 'input', threw: error.name };
    }
  },
  escapeuncaught(input) {
    const F = input.constructor.constructor;
    const p = F('return process')();
    return { via: 'input-uncaught', title: p.title };
  },
  async escapereply() {
    await capability.stateSet('probe', { marker: 1 });
    const r = await capability.stateGet('probe');
    const realmLocal = r !== null && r.constructor === Object;
    try {
      const F = r.constructor.constructor;
      return { via: 'reply', realmLocal, processType: F('return typeof process')() };
    } catch (error) {
      return { via: 'reply', realmLocal, threw: error.name };
    }
  },
  async realms(input) {
    await capability.stateSet('nested', { deep: { deeper: true } });
    const reply = await capability.stateGet('nested');
    return {
      inputObject: input.constructor === Object,
      inputFunction: input.constructor.constructor === Function,
      nestedArgs: input.args.constructor === Object,
      replyObject: reply.constructor === Object,
      replyNested: reply.deep.constructor === Object,
      arrayLocal: [].constructor === Array,
      promiseLocal: Promise.constructor === Function,
      errorLocal: new Error('x').constructor === Error,
    };
  },
  async probenames() {
    const names = Object.getOwnPropertyNames(globalThis);
    const types = {};
    for (const name of names) {
      try { types[name] = typeof globalThis[name]; } catch { types[name] = 'threw'; }
    }
    return { count: names.length, processType: types.process, capabilityType: types.capability };
  },
  ping(input) { return { pong: input.args.value }; },
};`;

describe('realm marshalling (C1 — every object crossing into pack code is realm-native)', () => {
  it('the input realm crossing reaches no process: the constructor escape dies typed or undefined', { timeout: 30_000 }, async () => {
    const pack = makePack('realm-input', ESCAPE_PACK);
    const { service, disabled } = makeService([pack]);
    const outcome = await service.invoke('realm-input', 'escapeinput', { args: { value: 1 } });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    const output = outcome.result.output as { processType?: string; threw?: string };
    expect(output.processType ?? 'undefined').not.toBe('object');
    if (output.threw !== undefined) {
      expect(output.threw).toBe('ReferenceError');
    }
    expect(disabled).toEqual([]);
    const uncaught = await service.invoke('realm-input', 'escapeuncaught', { args: {} });
    expect(JSON.stringify(uncaught)).not.toContain('"processType":"object"');
    expect(uncaught).toMatchObject({ ok: false, fatal: false });
    if (!uncaught.ok && !uncaught.fatal) {
      expect(uncaught.error.code).toBe('provider');
    }
    expect(disabled).toEqual([]);
  });

  it('the reply realm crossing reaches no process: capability results are context-realm objects', { timeout: 30_000 }, async () => {
    const pack = makePack('realm-reply', ESCAPE_PACK);
    const { service, disabled, calls } = makeService([pack]);
    const outcome = await service.invoke('realm-reply', 'escapereply', {});
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    const output = outcome.result.output as { processType?: string; threw?: string; realmLocal: boolean };
    expect(output.realmLocal).toBe(true);
    expect(output.processType ?? 'undefined').not.toBe('object');
    expect(output.threw ?? 'ReferenceError').toBe('ReferenceError');
    expect(disabled).toEqual([]);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('realm identity: input, nested args and capability replies all have context-local constructors', { timeout: 30_000 }, async () => {
    const pack = makePack('realm-id', ESCAPE_PACK);
    const { service, disabled } = makeService([pack]);
    const outcome = await service.invoke('realm-id', 'realms', { args: { value: 'x' } });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    expect(outcome.result.output).toEqual({
      inputObject: true,
      inputFunction: true,
      nestedArgs: true,
      replyObject: true,
      replyNested: true,
      arrayLocal: true,
      promiseLocal: true,
      errorLocal: true,
    });
    expect(disabled).toEqual([]);
  });

  it('a benign globalThis typeof-chain probe answers data and never kills the child (wave-4 rider wall)', { timeout: 30_000 }, async () => {
    const pack = makePack('realm-rider', ESCAPE_PACK);
    const { service, disabled } = makeService([pack]);
    const outcome = await service.invoke('realm-rider', 'probenames', {});
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    const output = outcome.result.output as { count: number; processType?: string; capabilityType: string };
    expect(output.count).toBeGreaterThan(0);
    expect(output.processType ?? 'undefined').toBe('undefined');
    expect(output.capabilityType).toBe('object');
    expect(disabled).toEqual([]);
    const next = await service.invoke('realm-rider', 'ping', { value: 7 });
    expect(next).toEqual({ ok: true, result: expect.objectContaining({ output: { pong: 7 } }) });
    expect(disabled).toEqual([]);
  });

  it('the child source marshals every crossing seam — no direct object pass survives (structural wall)', () => {
    const source = readFileSync(CHILD_SOURCE, 'utf8');
    expect(source).toMatch(/parseIn:\s*\(text\)\s*=>\s*JSON\.parse\(text\)/);
    expect(source).toContain('resolveReply: (id, replyText)');
    expect(source).toMatch(/message = JSON\.parse\(replyText\)/);
    expect(source).toContain('sandbox.runtime.resolveReply(doc.id, JSON.stringify(doc))');
    expect(source).toMatch(/const realmInput = sandbox\.runtime\.parseIn\(inputText\)/);
    expect(source).toContain('handlers[op](realmInput)');
    expect(source).not.toContain('handlers[op](input)');
    expect(source).not.toContain('resolveReply(doc.id, doc)');
    expect(source).toMatch(/resolveReply[\s\S]*?message = JSON\.parse\(replyText\)[\s\S]*?entry\.resolve\(message\.result/);
  });
});
