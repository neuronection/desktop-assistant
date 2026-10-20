import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { SandboxService, type SandboxCallRecord, type SandboxProcess, type SandboxRunRow, type SandboxSpawn, type SandboxSpawnOptions, type SandboxStore, type SandboxTarget } from '@main/apps/sandbox/SandboxService';
import { resetSandboxQuotaState, type SandboxStateStore } from '@main/apps/sandbox/capabilities';
import { DEFAULT_SANDBOX_LIMITS, validateManifest, type SandboxLimits } from '@shared/app-pack';
import { projectImportedEnvelope } from '@shared/app-pack/mapping';

const CHILD_PATH = join(process.cwd(), 'src', 'main', 'resources', 'sandbox-child.cjs');
const REFERENCE_PACK = join(process.cwd(), 'tests', 'fixtures', 'sandbox', 'reference-pack');

const base = (() => {
  const parent = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'sandbox-adv-'));
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

function makePack(name: string, entrySource: string, manifestExtra: Record<string, unknown> = {}, sourcePack?: string): PackFixture {
  const dir = join(base, name);
  mkdirSync(join(dir, 'code'), { recursive: true });
  const manifest = {
    apiVersion: 1,
    id: name,
    version: '1.0.0',
    kind: 'surface',
    capabilities: ['state', 'secrets', 'ui:chat-card'],
    secrets: [{ id: 'api-token' }],
    i18n: { defaultLocale: 'en', locales: { en: { title: name } } },
    entry: 'code/entry.js',
    ...manifestExtra,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (sourcePack) {
    copyFileSync(join(sourcePack, 'code', 'entry.js'), join(dir, 'code', 'entry.js'));
  } else {
    writeFileSync(join(dir, 'code', 'entry.js'), entrySource);
  }
  return {
    name,
    dir,
    manifest,
    manifestDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    contentDigest: digestTree(dir),
  };
}

const SPAWN_OPTIONS: SandboxSpawnOptions[] = [];

const nodeSpawn: SandboxSpawn = (options: SandboxSpawnOptions) => {
  SPAWN_OPTIONS.push(options);
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

function makeService(packs: PackFixture[], limits: Partial<SandboxLimits> = {}, secretValue: string | null = null) {
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
    childPath: () => CHILD_PATH,
    workdir: (packId) => {
      const dir = join(base, 'work', packId);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    resolveTarget: (packId) => targets.get(packId) ?? null,
    selfDisable: async (packId, reason) => disabled.push({ packId, reason }),
    store,
    stateStore,
    secretGet: async () => secretValue,
    limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, callTimeoutMs: 4000, spawnTimeoutMs: 8000, disposeTimeoutMs: 1500, ...limits }),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { service, runs, calls, disabled, stateData };
}

describe('adversarial matrix (S5 — the escape cases are the acceptance core)', () => {
  it('the reference-pack fixture stays sandbox-valid against the normative validator', () => {
    const manifest = JSON.parse(readFileSync(join(REFERENCE_PACK, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const projected = projectImportedEnvelope(manifest, 'T2');
    expect(projected.ok, projected.ok ? '' : projected.reason).toBe(true);
    if (!projected.ok) {
      return;
    }
    const verdict = validateManifest(projected.manifest, { bundled: false, sandboxed: true });
    expect(verdict.ok, verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')).toBe(true);
  });

  it('memory bomb ⇒ the heap cap or the watchdog kills the sandbox ⇒ self-disable, bounded', { timeout: 40_000 }, async () => {
    const bomb = makePack('bomb-pack', 'handlers = { bomb() { const chunks = []; for (;;) { try { chunks.push(new Array(1e6).fill("bomb")); } catch (e) {} } } };');
    const { service, disabled } = makeService([bomb], { callTimeoutMs: 3000, memoryMb: 64 });
    const started = Date.now();
    const outcome = await service.invoke('bomb-pack', 'bomb', {});
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(20_000);
    expect(outcome).toMatchObject({ ok: false, fatal: true });
    if (!outcome.ok && outcome.fatal) {
      expect(['crashed', 'watchdog']).toContain(outcome.outcome);
    }
    expect(disabled).toEqual([{ packId: 'bomb-pack', reason: expect.any(String) }]);
    expect(SPAWN_OPTIONS.at(-1)?.execArgv.join(' ')).toContain('--max-old-space-size=64');
  });

  it('a healthy pack survives the bomb — blast radius stays at one pack', { timeout: 60_000 }, async () => {
    const bomb = makePack('bomb2', 'handlers = { bomb() { const chunks = []; for (;;) { try { chunks.push(new Array(1e6).fill("bomb")); } catch (e) {} } } };');
    const healthy = makePack('healthy2', "handlers = { ping(input) { return { pong: input.args.value }; } };");
    const { service, disabled } = makeService([bomb, healthy], { callTimeoutMs: 3000, memoryMb: 64 });
    await service.invoke('bomb2', 'bomb', {});
    const healthyOutcome = await service.invoke('healthy2', 'ping', { value: 'still here' });
    expect(healthyOutcome).toEqual({ ok: true, result: expect.objectContaining({ output: { pong: 'still here' } }) });
    expect(disabled.map((entry) => entry.packId)).toEqual(['bomb2']);
  });

  it('prototype pollution payloads via IPC stay inert data — host globals untouched', { timeout: 30_000 }, async () => {
    const pack = makePack(
      'pollute-pack',
      `handlers = {
  async pollute() {
    await capability.stateSet('proto', JSON.parse('{"__proto__":{"polluted":"yes"}}'));
    await capability.stateSet('ctor', JSON.parse('{"constructor":{"prototype":{"polluted2":"yes"}}}'));
    const accepted = await capability.itemsEmit([JSON.parse('{"__proto__":{"polluted":"yes"}}')]);
    return { accepted, back: await capability.stateGet('proto') };
  },
};`
    );
    const { service, stateData } = makeService([pack]);
    const outcome = await service.invoke('pollute-pack', 'pollute', {});
    expect(outcome).toMatchObject({ ok: true });
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted2).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    const stored = stateData.get('pollute-pack')?.get('proto') as Record<string, unknown>;
    expect(JSON.stringify(stored)).toContain('polluted');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('secret sniffing finds nothing: no env, no process, the placeholder is the only surface', { timeout: 30_000 }, async () => {
    const pack = makePack(
      'sniff-pack',
      `handlers = {
  async sniff() {
    const findings = [];
    findings.push(typeof process);
    findings.push(typeof require);
    try { findings.push(String(globalThis.constructor('return Object.keys(globalThis)')().length)); } catch { findings.push('denied'); }
    let secret = null;
    try {
      secret = await capability.secretsNeed('api-token');
    } catch (error) {
      findings.push(error.code);
    }
    return { findings, secret };
  },
};`
    );
    const secret = 'the-secret-value-xyz';
    const { service } = makeService([pack], {}, secret);
    const outcome = await service.invoke('sniff-pack', 'sniff', {});
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    const transcript = JSON.stringify(outcome.result);
    expect(transcript).not.toContain(secret);
    expect(outcome.result.output.secret).toBe('{{secret:api-token}}');
    expect((outcome.result.output.findings as string[])[0]).toBe('undefined');
    expect((outcome.result.output.findings as string[])[1]).toBe('undefined');
  });

  it('a crash attempt (process.exit) is denied and the invoke ends cleanly', { timeout: 30_000 }, async () => {
    const pack = makePack(
      'crash-pack',
      `handlers = {
  async exit() {
    try {
      process.exit(1);
      return { crashed: true };
    } catch (error) {
      return { denied: true, name: error.name };
    }
  },
  ping(input) { return { pong: input.args.value }; },
};`
    );
    const { service, disabled } = makeService([pack]);
    const outcome = await service.invoke('crash-pack', 'exit', {});
    expect(outcome).toMatchObject({ ok: true, result: { output: { denied: true } } });
    expect(disabled).toEqual([]);
    const next = await service.invoke('crash-pack', 'ping', { value: 1 });
    expect(next).toMatchObject({ ok: true, result: { output: { pong: 1 } } });
  });

  it('bytes/day exhaustion ⇒ typed budget, clean end', { timeout: 30_000 }, async () => {
    const pack = makePack(
      'bytes-pack',
      `handlers = {
  async fill(input) {
    const codes = [];
    for (let i = 0; i < input.args.rounds; i += 1) {
      try {
        await capability.stateSet('k' + i, 'x'.repeat(input.args.size));
        codes.push('ok');
      } catch (error) {
        codes.push(error.code);
      }
    }
    return { codes };
  },
};`
    );
    const { service, disabled } = makeService([pack], { bytesPerDay: 1024 });
    const outcome = await service.invoke('bytes-pack', 'fill', { rounds: 12, size: 200 });
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) {
      const codes = (outcome.result.output as { codes: string[] }).codes;
      expect(codes[0]).toBe('ok');
      expect(codes).toContain('budget');
    }
    expect(disabled).toEqual([]);
  });

  it('the reference pack exercises the full surface through one pipeline install', { timeout: 40_000 }, async () => {
    const pack = makePack('refpack', '', {}, REFERENCE_PACK);
    pack.manifest.id = 'refpack';
    const { service, disabled } = makeService([pack], {}, 'secret-value-should-never-cross');
    const outcome = await service.invoke('refpack', 'command:full-surface', { argv: ['km'] });
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) {
      return;
    }
    const output = outcome.result.output as { last: unknown; accepted: number; secretStatus: { injectedAs?: string }; net: string };
    expect(output.accepted).toBe(1);
    expect(output.secretStatus.injectedAs).toBe('{{secret:api-token}}');
    expect(output.net).toBe('net-denied');
    expect(outcome.result.progressEvents).toEqual([{ percent: 50, messageKey: 'refpack.progress.half' }]);
    expect(outcome.result.logEvents[0]).toMatchObject({ level: 'info' });
    expect(JSON.stringify(outcome)).not.toContain('secret-value-should-never-cross');
    const convert = await service.invoke('refpack', 'command:convert', { argv: ['21'] });
    expect(convert).toEqual({ ok: true, result: expect.objectContaining({ output: { converted: 42, unit: 'km' } }) });
    expect(disabled).toEqual([]);
  });
});
