import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITY_RPC_SCHEMA } from '@shared/app-pack';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import { SandboxService, type SandboxCallRecord, type SandboxProcess, type SandboxRunRow, type SandboxSpawn, type SandboxSpawnOptions, type SandboxStore, type SandboxTarget } from '@main/apps/sandbox/SandboxService';
import { resetSandboxQuotaState, type SandboxStateStore } from '@main/apps/sandbox/capabilities';
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from '@shared/app-pack/sandbox';
import { DEFAULT_RETRYABLE, encodeFrame, validateFrame } from '@main/apps/sandbox/protocol';

const CHILD_PATH = join(process.cwd(), 'src', 'main', 'resources', 'sandbox-child.cjs');

const base = (() => {
  const parent = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'sandbox-rpc-'));
})();

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
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
  dir: string;
  manifest: Record<string, unknown>;
  manifestDigest: string;
  contentDigest: string;
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
    secrets: [{ id: 'api-token' }],
    i18n: { defaultLocale: 'en', locales: { en: { title: name } } },
    entry: 'code/entry.js',
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
    limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, callTimeoutMs: 3000, spawnTimeoutMs: 8000, disposeTimeoutMs: 1500, ...limits }),
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { service, runs, calls, disabled, stateData };
}

const RPC_ENTRY = `
handlers = {
  async state(input) {
    await capability.stateSet(input.args.key, input.args.value);
    return { back: await capability.stateGet(input.args.key) };
  },
  async items(input) {
    try {
      const accepted = await capability.itemsEmit(input.args.items);
      return { accepted };
    } catch (error) {
      return { code: error.code, detail: error.detail };
    }
  },
  async secrets(input) {
    try {
      return { injectedAs: await capability.secretsNeed(input.args.slot) };
    } catch (error) {
      return { code: error.code, retryable: error.retryable };
    }
  },
  async net() {
    try {
      await capability.netFetch('https://example.invalid/');
      return { net: 'allowed' };
    } catch (error) {
      return { code: error.code, retryable: error.retryable };
    }
  },
  async events(input) {
    for (let i = 0; i < input.args.count; i += 1) {
      capability.progress(i);
      capability.log('info', 'tick ' + i);
    }
    return { sent: input.args.count };
  },
  async quota(input) {
    const codes = [];
    for (let i = 0; i < input.args.calls; i += 1) {
      try {
        await capability.stateSet('k' + i, i);
        codes.push('ok');
      } catch (error) {
        codes.push(error.code);
      }
    }
    return { codes };
  },
  async undeclared(input) {
    try {
      await capability.secretsNeed(input.args.slot);
      return { resolved: true };
    } catch (error) {
      return { code: error.code, detail: error.detail };
    }
  },
};
`;

beforeEach(() => {
  resetSandboxQuotaState();
});

describe('capability RPC seam (S2 — ADR-0030 clause 4, capability-rpc/1)', () => {
  it('the vendored rpc fixtures pass and fail exactly through the embedded schema', () => {
    const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'extension-contract.fixtures.json'), 'utf8')) as {
      rpc: { valid: { name: string; doc: unknown }[]; invalid: { name: string; because: string; doc: unknown }[] };
    };
    expect(fixtures.rpc.valid.length).toBeGreaterThanOrEqual(5);
    for (const fixture of fixtures.rpc.valid) {
      expect(checkSchema(CAPABILITY_RPC_SCHEMA, fixture.doc).ok, fixture.name).toBe(true);
      expect(() => validateFrame(fixture.doc)).not.toThrow();
    }
    for (const fixture of fixtures.rpc.invalid) {
      expect(checkSchema(CAPABILITY_RPC_SCHEMA, fixture.doc).ok, `${fixture.name} (${fixture.because})`).toBe(false);
      expect(() => validateFrame(fixture.doc)).toThrow();
    }
  });

  it('the charter error enum backs the default retryable map', () => {
    expect(DEFAULT_RETRYABLE['net-denied']).toBe('no');
    expect(DEFAULT_RETRYABLE['needs-secret']).toBe('after-config-change');
    expect(DEFAULT_RETRYABLE['rate-limited']).toBe('after-delay');
    expect(DEFAULT_RETRYABLE['budget']).toBe('after-config-change');
  });

  it('cap.state.get/set round trips host-persisted state across invocations', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-state', RPC_ENTRY);
    const { service, stateData } = makeService([pack]);
    const first = await service.invoke('rpc-state', 'state', { key: 'counter', value: { n: 7 } });
    expect(first).toMatchObject({ ok: true, result: { output: { back: { n: 7 } } } });
    expect(stateData.get('rpc-state')?.get('counter')).toEqual({ n: 7 });
    const second = await service.invoke('rpc-state', 'state', { key: 'other', value: 'x' });
    expect(second).toMatchObject({ ok: true });
    expect(stateData.get('rpc-state')?.size).toBe(2);
  });

  it('cap.items.emit validates shape and size; invalid batches are rejected typed', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-items', RPC_ENTRY);
    const { service } = makeService([pack]);
    const good = await service.invoke('rpc-items', 'items', { items: [{ kind: 'note', text: 'hi' }] });
    expect(good).toMatchObject({ ok: true, result: { output: { accepted: 1 }, items: [{ kind: 'note' }] } });
    const notObject = await service.invoke('rpc-items', 'items', { items: ['nope'] });
    expect(notObject).toMatchObject({ ok: true, result: { output: { code: 'invalid' } } });
    const tooBig = await service.invoke('rpc-items', 'items', { items: [{ blob: 'x'.repeat(40 * 1024) }] });
    expect(tooBig).toMatchObject({ ok: true, result: { output: { code: 'invalid' } } });
    const tooMany = await service.invoke('rpc-items', 'items', { items: Array.from({ length: 257 }, (_, i) => ({ i })) });
    expect(tooMany).toMatchObject({ ok: true, result: { output: { code: 'invalid' } } });
  });

  it('cap.secrets.need returns resolution status and a placeholder — the value never crosses', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-secrets', RPC_ENTRY);
    const secretValue = 'super-secret-value-12345';
    const withSecret = makeService([pack], {}, secretValue);
    const resolved = await withSecret.service.invoke('rpc-secrets', 'secrets', { slot: 'api-token' });
    expect(resolved).toMatchObject({ ok: true, result: { output: { injectedAs: '{{secret:api-token}}' } } });
    const transcript = JSON.stringify(resolved);
    expect(transcript).not.toContain(secretValue);

    const without = makeService([pack], {}, null);
    const missing = await without.service.invoke('rpc-secrets', 'secrets', { slot: 'api-token' });
    expect(missing).toMatchObject({ ok: true, result: { output: { code: 'needs-secret', retryable: 'after-config-change' } } });

    const undeclared = makeService([pack], {}, secretValue);
    const unknownSlot = await undeclared.service.invoke('rpc-secrets', 'undeclared', { slot: 'undeclared-slot' });
    expect(unknownSlot).toMatchObject({ ok: true, result: { output: { code: 'invalid' } } });
  });

  it('cap.net.fetch answers the typed net-denied (the v1 seam stance) and audits it', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-net', RPC_ENTRY);
    const { service, calls } = makeService([pack]);
    const outcome = await service.invoke('rpc-net', 'net', {});
    expect(outcome).toMatchObject({ ok: true, result: { output: { code: 'net-denied', retryable: 'no' } } });
    const netRow = calls.find((call) => call.method === 'cap.net.fetch');
    expect(netRow).toMatchObject({ ok: false, errorCode: 'net-denied', packId: 'rpc-net', digest: pack.manifestDigest });
  });

  it('quota exhaustion answers budget and the invoke ends cleanly', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-quota', RPC_ENTRY);
    const { service, disabled } = makeService([pack], { maxCallsPerInvoke: 4 });
    const outcome = await service.invoke('rpc-quota', 'quota', { calls: 8 });
    expect(outcome).toMatchObject({ ok: true, result: { output: { codes: ['ok', 'ok', 'ok', 'ok', 'budget', 'budget', 'budget', 'budget'] } } });
    expect(disabled).toEqual([]);
  });

  it('events are rate-capped and validated per invoke', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-events', RPC_ENTRY);
    const { service } = makeService([pack], { eventsPerInvoke: 4 });
    const outcome = await service.invoke('rpc-events', 'events', { count: 5 });
    expect(outcome).toMatchObject({ ok: true, result: { eventsDropped: 6 } });
    if (outcome.ok) {
      expect(outcome.result.progressEvents).toHaveLength(2);
      expect(outcome.result.logEvents).toHaveLength(2);
    }
  });

  it('one audit row lands per capability call — success or failure', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-audit', RPC_ENTRY);
    const { service, calls } = makeService([pack], {}, 'token-value');
    await service.invoke('rpc-audit', 'state', { key: 'k', value: 1 });
    await service.invoke('rpc-audit', 'secrets', { slot: 'api-token' });
    await service.invoke('rpc-audit', 'net', {});
    const stateRows = calls.filter((call) => call.method === 'cap.state.set');
    expect(stateRows).toHaveLength(1);
    expect(stateRows[0].argsHash).toBe(createHash('sha256').update(JSON.stringify({ key: 'k', value: 1 })).digest('hex'));
    expect(stateRows[0].ok).toBe(true);
    expect(stateRows[0].callNumber).toBe(1);
    const secretRows = calls.filter((call) => call.method === 'cap.secrets.need');
    expect(secretRows).toHaveLength(1);
    expect(secretRows[0].ok).toBe(true);
    const netRows = calls.filter((call) => call.method === 'cap.net.fetch');
    expect(netRows[0].ok).toBe(false);
    expect(calls.every((call) => typeof call.durationMs === 'number' && call.durationMs >= 0)).toBe(true);
  });

  it('undeclared capabilities are refused at the seam (unsupported for state, the slot law for secrets)', { timeout: 30_000 }, async () => {
    const pack = makePack('rpc-undeclared', RPC_ENTRY, { capabilities: ['ui:chat-card'], secrets: [{ id: 'api-token' }] });
    const { service } = makeService([pack], {}, 'token');
    const stateOutcome = await service.invoke('rpc-undeclared', 'state', { key: 'k', value: 1 });
    expect(stateOutcome).toMatchObject({ ok: false, fatal: false, error: { code: 'unsupported' } });
    const slotOutcome = await service.invoke('rpc-undeclared', 'undeclared', { slot: 'api-token' });
    expect(slotOutcome).toMatchObject({
      ok: true,
      result: { output: { code: 'invalid', detail: expect.stringContaining('slot not declared') } },
    });
  });

  it('host framing: outbound frames are byte-capped, unknown methods refused, violations recycle', async () => {
    expect(() => encodeFrame({ v: 1, type: 'call', id: 1, method: 'ext.invoke', params: { blob: 'x'.repeat(1_048_576) } })).toThrow();
    expect(() => validateFrame({ v: 1, type: 'call', id: 1, method: 'cap.fs.read', params: {} })).toThrow();

    let killed = 0;
    const listeners = new Set<(message: unknown) => void>();
    const exits: ((code: number | null) => void)[] = [];
    const fake: SandboxProcess = {
      pid: 1,
      send: () => undefined,
      onMessage: (listener) => listeners.add(listener),
      onExit: (listener) => exits.push(listener),
      kill: () => {
        killed += 1;
        for (const exit of exits) exit(3);
      },
    };
    const pack = makePack('rpc-router', RPC_ENTRY);
    const { runs, disabled } = makeService([pack]);
    const service = new SandboxService({
      spawn: () => fake,
      childPath: () => CHILD_PATH,
      workdir: (id) => join(base, 'work', id),
      resolveTarget: (id) => ({ packId: id, manifest: pack.manifest, contentPath: pack.dir, manifestDigest: pack.manifestDigest, contentDigest: pack.contentDigest, config: {} }),
      selfDisable: async (packId, reason) => disabled.push({ packId, reason }),
      store: {
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
        appendCall: async () => undefined,
      },
      stateStore: { get: async () => null, all: async () => ({}), set: async () => undefined },
      secretGet: async () => null,
      limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, spawnTimeoutMs: 4000 }),
      now: () => Date.now(),
      sha256: (input) => createHash('sha256').update(input).digest('hex'),
    });
    const pending = service.invoke('rpc-router', 'state', { key: 'k', value: 1 });
    for (const listener of listeners) {
      listener('garbage');
      listener('garbage');
      listener('garbage');
    }
    const outcome = await pending;
    expect(killed).toBeGreaterThanOrEqual(1);
    expect(outcome).toMatchObject({ ok: false, fatal: true, outcome: 'protocol-violation' });
    expect(disabled[0].reason).toContain('protocol violations');
  });
});
