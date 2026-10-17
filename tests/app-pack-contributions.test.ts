import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MiniAppRegistry, type InstalledMiniApp } from '@main/apps/registry';
import { SandboxService, type SandboxCallRecord, type SandboxRunRow, type SandboxSpawn, type SandboxSpawnOptions, type SandboxStore, type SandboxTarget } from '@main/apps/sandbox/SandboxService';
import { resetSandboxQuotaState, type SandboxStateStore } from '@main/apps/sandbox/capabilities';
import { createContributionBridge } from '@main/apps/contributions';
import { CommandService } from '@main/services/CommandService';
import { DEFAULT_SANDBOX_LIMITS, type SandboxLimits } from '@shared/app-pack';
import type { AppConfig } from '@shared/config/AppConfig';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';

const CHILD_PATH = join(process.cwd(), 'src', 'main', 'resources', 'sandbox-child.cjs');

const base = (() => {
  const parent = join(process.cwd(), 'node_modules', '.tmp');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, 'sandbox-contrib-'));
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

const CONVERT_ENTRY = `
handlers = {
  'command:convert'(input) {
    const rate = input.config.rate ?? 2;
    const value = Number(input.args.argv[0] ?? 0);
    return { converted: value * rate, unit: input.config.unit ?? 'km' };
  },
};
`;

const MANIFEST = {
  apiVersion: 1,
  id: 'refpack',
  version: '1.0.0',
  kind: 'surface',
  title: 'RefPack',
  capabilities: ['state', 'secrets', 'ui:chat-card', 'ui:settings'],
  secrets: [{ id: 'api-token' }],
  configSchema: { type: 'object', properties: { rate: { type: 'number', default: 2 }, unit: { type: 'string', default: 'km' } } },
  contributions: {
    commands: [{ id: 'command:convert', labelKey: 'cmd.convert' }],
    'settings-page': [{ id: 'refpack:settings' }],
  },
  i18n: { defaultLocale: 'en', locales: { en: { title: 'RefPack', description: 'The Tier-2 reference pack.' } } },
  code: { entry: 'code/entry.js' },
};

function landPack(): { dir: string; manifest: typeof MANIFEST; manifestDigest: string; contentDigest: string } {
  const dir = join(base, 'refpack');
  mkdirSync(join(dir, 'code'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(MANIFEST, null, 2));
  writeFileSync(join(dir, 'code', 'entry.js'), CONVERT_ENTRY);
  return {
    dir,
    manifest: MANIFEST,
    manifestDigest: createHash('sha256').update(JSON.stringify(MANIFEST)).digest('hex'),
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

function makeRegistry(manifest: unknown, contentPath: string): MiniAppRegistry {
  const packs: InstalledMiniApp[] = [
    {
      manifest,
      origin: { kind: 'imported', path: contentPath, importedAt: 1 },
      digest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      enabled: true,
    },
  ];
  const config = { ...DEFAULT_CONFIG, miniApps: { ...DEFAULT_CONFIG.miniApps, masterEnabled: true, packs } } as AppConfig;
  return new MiniAppRegistry({
    config: () => config,
    updateMiniApps: async (patch) => {
      Object.assign(config.miniApps, patch);
    },
    now: () => Date.now(),
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
}

describe('Tier-2 declarative contributions (S3 — ADR-0030 clause 3)', () => {
  it('a declared command dispatches one sandboxed invoke and returns data', { timeout: 30_000 }, async () => {
    const pack = landPack();
    const registry = makeRegistry(pack.manifest, pack.dir);
    const disabled: { packId: string; reason: string }[] = [];
    const sandbox = new SandboxService({
      spawn: nodeSpawn,
      childPath: () => CHILD_PATH,
      workdir: (id) => {
        const dir = join(base, 'work', id);
        mkdirSync(dir, { recursive: true });
        return dir;
      },
      resolveTarget: (id): SandboxTarget | null =>
        id === 'refpack'
          ? { packId: id, manifest: pack.manifest, contentPath: pack.dir, manifestDigest: pack.manifestDigest, contentDigest: pack.contentDigest, config: {} }
          : null,
      selfDisable: async (packId, reason) => disabled.push({ packId, reason }),
      store: {
        createRun: async () => undefined,
        closeRun: async () => undefined,
        openRuns: async () => [] as SandboxRunRow[],
        appendCall: async (_record: SandboxCallRecord) => undefined,
      },
      stateStore: { get: async () => null, all: async () => ({}), set: async () => undefined } satisfies SandboxStateStore,
      secretGet: async () => null,
      limits: () => ({ ...DEFAULT_SANDBOX_LIMITS, callTimeoutMs: 3000, spawnTimeoutMs: 8000 }),
      now: () => Date.now(),
      sha256: (input) => createHash('sha256').update(input).digest('hex'),
    });
    const bridge = createContributionBridge({ registry, sandbox });
    expect(registry.getState().packs[0].sandboxed).toBe(true);
    expect(registry.getState().packs[0].commands).toEqual(['command:convert']);
    const outcome = await bridge.executePackCommand('refpack', 'command:convert', ['21']);
    console.log('BRIDGE OUTCOME', JSON.stringify(outcome));
    expect(outcome).toMatchObject({ ok: true, text: expect.stringContaining(JSON.stringify({ converted: 42, unit: 'km' })) });
    const undeclared = await bridge.executePackCommand('refpack', 'command:undeclared', []);
    expect(undeclared).toMatchObject({ ok: false, error: expect.stringContaining('undeclared command') });
    const unknownPack = await bridge.executePackCommand('otherpack', 'command:convert', []);
    expect(unknownPack).toMatchObject({ ok: false, error: expect.stringContaining('Unknown sandboxed pack') });
    expect(disabled).toEqual([]);
  });

  it('disabled or digest-invalid packs refuse dispatch', { timeout: 30_000 }, async () => {
    const pack = landPack();
    const registry = makeRegistry(pack.manifest, pack.dir);
    await registry.setEnabled('refpack', false);
    const sandbox = new SandboxService({
      spawn: nodeSpawn,
      childPath: () => CHILD_PATH,
      workdir: (id) => join(base, 'work', id),
      resolveTarget: () => null,
      selfDisable: async () => undefined,
      store: { createRun: async () => undefined, closeRun: async () => undefined, openRuns: async () => [], appendCall: async () => undefined },
      stateStore: { get: async () => null, all: async () => ({}), set: async () => undefined },
      secretGet: async () => null,
      limits: () => DEFAULT_SANDBOX_LIMITS,
      now: () => Date.now(),
      sha256: (input) => createHash('sha256').update(input).digest('hex'),
    });
    const bridge = createContributionBridge({ registry, sandbox });
    expect(await bridge.executePackCommand('refpack', 'command:convert', [])).toMatchObject({
      ok: false,
      error: expect.stringContaining('Unknown sandboxed pack'),
    });
  });

  it('the palette lists sandboxed commands as miniapp:cmd entries and dispatches through the bridge', async () => {
    const executed: { packId: string; commandId: string; args: string[] }[] = [];
    const service = new CommandService({
      client: null,
      config: () => DEFAULT_CONFIG.commands,
      toolCatalog: () => [],
      isToolDisabled: () => false,
      grantedRoots: () => [],
      actions: { newConversation: () => undefined, toggleExpand: () => undefined, openDesktop: () => undefined, openSettings: () => undefined, hideLauncher: () => undefined, quit: () => undefined },
      miniAppPacks: () => [
        { id: 'refpack', kind: 'surface', title: 'RefPack', description: '', enabled: true, sandboxed: true, commands: ['command:convert'] },
        { id: 'mini-calc', kind: 'surface', title: 'Calculator', description: '', enabled: true, commands: ['calc:evaluate'] },
      ],
      executeMiniAppCommand: async (packId, commandId, args) => {
        executed.push({ packId, commandId, args });
        return { ok: true, text: 'converted' };
      },
    });
    const entries = service.list().filter((entry) => entry.id.startsWith('miniapp:cmd:'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'miniapp:cmd:refpack:command:convert', action: 'miniapp:command' });
    const outcome = await service.execute('miniapp:cmd:refpack:command:convert', ['21'], 'user');
    expect(outcome).toMatchObject({ status: 'done', text: 'converted' });
    expect(executed).toEqual([{ packId: 'refpack', commandId: 'command:convert', args: ['21'] }]);
    const tier1 = service.list().filter((entry) => entry.id === 'calc:evaluate');
    expect(tier1).toHaveLength(1);
  });
});
