import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionSourcesService, discoverManifests, digestTree } from '@main/apps/sources/lifecycle';
import { MiniAppRegistry, type InstalledMiniApp } from '@main/apps/registry';
import { validateManifest } from '@shared/app-pack';
import { EXTENSION_CHARTER, T2_SANDBOX_DISCLOSURE } from '@shared/app-pack';
import { capabilitiesFor, PackCapabilityError } from '@main/apps/capabilities';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import type { GitTransport, ResolvedRef } from '@main/apps/sources/transport';

const T2_MANIFEST = {
  apiVersion: 1,
  id: 'refpack',
  version: '1.0.0',
  kind: 'surface',
  title: 'RefPack',
  capabilities: ['state', 'secrets', 'ui:chat-card', 'ui:settings'],
  secrets: [{ id: 'api-token' }],
  configSchema: { type: 'object', properties: { rate: { type: 'number', default: 2 } } },
  contributions: { commands: [{ id: 'command:convert' }] },
  i18n: { defaultLocale: 'en', locales: { en: { title: 'RefPack', description: 'The Tier-2 reference pack.' } } },
  code: { entry: 'code/entry.js' },
};

const T2_ENTRY = "handlers = { 'command:convert'(input) { return { converted: 42 }; } };\n";

async function writeT2Tree(root: string, mutateEntry: (source: string) => string = (source) => source): Promise<string> {
  const tree = join(root, 'tree');
  await mkdir(join(tree, 'code'), { recursive: true });
  await writeFile(join(tree, 'manifest.json'), JSON.stringify(T2_MANIFEST, null, 2));
  await writeFile(join(tree, 'code', 'entry.js'), mutateEntry(T2_ENTRY));
  return tree;
}

class FakeTransport implements GitTransport {
  private refs: string[] = [];
  private trees: (string | null)[] = [];
  private lastTree: string | null = null;
  private lastRef = 'v1.0.0';

  stage(ref: string, tree: string | null): void {
    this.refs.push(ref);
    this.trees.push(tree);
    this.lastTree = tree;
    this.lastRef = ref;
  }

  async resolve(_origin: string, ref: { strategy: string; value?: string }): Promise<ResolvedRef> {
    const name = this.refs.shift() ?? this.lastRef;
    if (ref.strategy === 'commit-pin') {
      return { ref: ref.value ?? name, sha: ref.value ?? name, fetchRef: ref.value ?? name };
    }
    const sha = createHash('sha256').update(`${name}:${this.trees.length}`).digest('hex');
    return { ref: name, sha, fetchRef: name };
  }

  async fetch(_origin: string, _resolved: ResolvedRef, dest: string): Promise<void> {
    const tree = this.trees.shift() ?? this.lastTree;
    if (!tree) {
      throw new Error('FakeTransport: no staged tree');
    }
    const { cp } = await import('node:fs/promises');
    await cp(tree, dest, { recursive: true });
  }

  async tempRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'da-sbx-import-'));
  }
}

function createHarness() {
  let config: AppConfig = structuredClone(DEFAULT_CONFIG);
  const packsDir = join(tmpdir(), `da-sbx-packs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const transport = new FakeTransport();
  const registry = new MiniAppRegistry({
    config: () => config,
    updateMiniApps: async (patch) => {
      config = { ...config, miniApps: { ...config.miniApps, ...patch } };
    },
    now: () => 1_700_000_000_000,
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  const service = new ExtensionSourcesService({
    miniApps: () => ({
      sources: (config.miniApps.sources ?? []).map((source) => ({ ...source })),
      sourceInstalls: (config.miniApps.sourceInstalls ?? []).map((install) => ({ ...install })),
      packs: config.miniApps.packs.map((pack) => ({ manifest: pack.manifest, enabled: pack.enabled, ...(pack.error ? { error: pack.error } : {}) })),
    }),
    updateMiniApps: async (patch) => {
      config = { ...config, miniApps: { ...config.miniApps, ...patch } };
    },
    registry: {
      importManifest: (json, origin) => registry.importManifest(json, origin),
      setEnabled: (id, enabled) => registry.setEnabled(id, enabled),
    },
    transport,
    contentRoot: () => packsDir,
    secretStore: {
      get: async () => null,
      set: async () => undefined,
    },
    newId: () => `id-${Math.random().toString(36).slice(2)}`,
    now: () => 1_700_000_000_000,
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  const read = () => config.miniApps;
  return { service, transport, registry, read, packsDir };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-sbx-import-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Tier-2 import through the sources pipeline (S4 — ADR-0030 clause 5)', () => {
  it('discovery classifies a code pack as T2 and refuses drift-classified junk loudly', async () => {
    const tree = await writeT2Tree(root);
    const found = await discoverManifests(tree, '');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ extensionId: 'refpack', tier: 'T2' });
    const junk = join(root, 'junk');
    await mkdir(junk, { recursive: true });
    await writeFile(join(junk, 'manifest.json'), JSON.stringify({ hello: true, code: { entry: 'x.js' } }));
    await expect(discoverManifests(junk, '')).rejects.toThrow(/sandboxed manifest invalid/);
  });

  it('sync offers the T2 candidate with the sandbox disclosure VERBATIM and the content digest', async () => {
    const { service, transport } = createHarness();
    await service.addSource({ local: { path: root }, ref: { strategy: 'tag', value: 'v1' } });
    const tree = await writeT2Tree(root);
    transport.stage('v1', tree);
    const sync = await service.syncSource((await service.listState()).sources[0].id);
    expect(sync.ok).toBe(true);
    if (!sync.ok) {
      return;
    }
    const candidate = sync.candidates[0];
    expect(candidate.consent.tier).toBe('T2');
    expect(candidate.consent.disclosure).toBe(T2_SANDBOX_DISCLOSURE);
    expect(candidate.consent.disclosure).toBe(EXTENSION_CHARTER.consent.t2SandboxDisclosure);
    expect(candidate.consent.capabilities).toEqual(T2_MANIFEST.capabilities);
    expect(candidate.digest).toBe(digestTree(tree));
    expect(candidate.compatible).toBe(true);
  });

  it('install lands the whole content subtree, digest-pinned, sandboxed and DISABLED', async () => {
    const { service, transport, registry, read, packsDir } = createHarness();
    await service.addSource({ local: { path: root }, ref: { strategy: 'tag', value: 'v1' } });
    const tree = await writeT2Tree(root);
    transport.stage('v1', tree);
    const sourceId = (await service.listState()).sources[0].id;
    await service.syncSource(sourceId);
    const install = await service.installExtension(sourceId, 'refpack', true);
    expect(install.ok).toBe(true);
    const record = read().sourceInstalls?.[0];
    expect(record?.contentDigest).toBe(digestTree(tree));
    expect(record?.consents[0].tier).toBe('T2');
    expect(record?.consents[0].disclosure).toBe(T2_SANDBOX_DISCLOSURE);
    expect(existsSync(join(packsDir, 'refpack', record?.digest ?? '', 'code', 'entry.js'))).toBe(true);
    const view = registry.getState().packs.find((candidate) => candidate.id === 'refpack');
    expect(view?.sandboxed).toBe(true);
    expect(view?.enabled).toBe(false);
    expect(view?.commands).toEqual(['command:convert']);
  });

  it('code drift on the pinned ref is a loud digest-drift, never an apply', async () => {
    const { service, transport, read } = createHarness();
    await service.addSource({ local: { path: root }, ref: { strategy: 'tag', value: 'v1' } });
    const tree = await writeT2Tree(root);
    transport.stage('v1', tree);
    const sourceId = (await service.listState()).sources[0].id;
    await service.syncSource(sourceId);
    await service.installExtension(sourceId, 'refpack', true);
    transport.stage('v1', await writeT2Tree(root, (source) => `${source}\n// tampered\n`));
    const sync = await service.syncSource(sourceId);
    expect(sync.ok).toBe(true);
    const install = read().sourceInstalls?.[0];
    expect(install?.update).toMatchObject({ state: 'digest-drift' });
  });

  it('a T2 update always re-consents — there is no code auto-apply window', async () => {
    const { service, transport, read } = createHarness();
    await service.addSource({ local: { path: root }, ref: { strategy: 'tag', value: 'v1' } });
    transport.stage('v1', await writeT2Tree(root));
    const sourceId = (await service.listState()).sources[0].id;
    await service.syncSource(sourceId);
    await service.installExtension(sourceId, 'refpack', true);
    const updated = JSON.parse(JSON.stringify(T2_MANIFEST).replace('"1.0.0"', '"1.0.1"')) as typeof T2_MANIFEST;
    const tree2 = join(root, 'tree2');
    await mkdir(join(tree2, 'code'), { recursive: true });
    await writeFile(join(tree2, 'manifest.json'), JSON.stringify(updated, null, 2));
    await writeFile(join(tree2, 'code', 'entry.js'), T2_ENTRY);
    transport.stage('v1.0.1', tree2);
    const sync = await service.syncSource(sourceId);
    expect(sync.ok).toBe(true);
    const install = read().sourceInstalls?.[0];
    expect(install?.update).toMatchObject({ state: 'available', requiresReconsent: true });
    const refused = await service.applyUpdate(sourceId, 'refpack', false);
    expect(refused.ok).toBe(false);
    const applied = await service.applyUpdate(sourceId, 'refpack', true);
    expect(applied.ok).toBe(true);
    expect(read().sourceInstalls?.[0].consents.at(-1)?.reconsent).toBe(true);
    expect(read().sourceInstalls?.[0].consents.at(-1)?.tier).toBe('T2');
  });

  it('direct manifest import of a code pack is refused — Tier 2 rides the pipeline only', async () => {
    const { registry } = createHarness();
    const refused = await registry.importManifest(JSON.stringify(T2_MANIFEST), { kind: 'imported' });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error).toContain('extension sources pipeline');
  });

  it('the arm path is structurally unavailable to sandboxed packs', () => {
    const verdict = validateManifest({ ...T2_MANIFEST, kind: 'assessment', capabilities: ['fs-write-quarantine', 'fs-read', 'run'], secrets: undefined, code: undefined, privacy: { sendsContent: false }, run: { classify: { keep: [{ id: 'k', when: { signal: 'meta.ext', op: 'eq', value: '.md' } }] }, propose: { verb: 'quarantine', gate: { minConfidence: 0.9 } } } }, { bundled: false, sandboxed: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? [] : verdict.issues.map((issue) => issue.code)).toContain('kind');

    const surface = validateManifest(T2_MANIFEST, { bundled: false, sandboxed: true });
    expect(surface.ok).toBe(true);
    const fakePack = surface.ok ? surface.pack : null;
    expect(fakePack).not.toBeNull();
    if (fakePack) {
      expect(() => capabilitiesFor(fakePack, {} as never).fs).toThrow(PackCapabilityError);
      expect(() => capabilitiesFor(fakePack, {} as never).run).toThrow(PackCapabilityError);
      expect(() => capabilitiesFor(fakePack, {} as never).decide).toThrow(PackCapabilityError);
    }
  });

  it('the sandbox validator walls: net is the exfiltration class, the grant set is closed, cross-refs bind', () => {
    const net = validateManifest({ ...T2_MANIFEST, capabilities: ['state', 'net'] }, { bundled: false, sandboxed: true });
    expect(net.ok).toBe(false);
    expect(net.ok ? '' : net.issues.map((issue) => issue.message).join('; ')).toContain('exfiltration');

    const unhonored = validateManifest({ ...T2_MANIFEST, capabilities: ['state', 'ui:panel'] }, { bundled: false, sandboxed: true });
    expect(unhonored.ok).toBe(false);
    expect(unhonored.ok ? '' : unhonored.issues.map((issue) => issue.message).join('; ')).toContain('not grantable to imported code packs');

    const noSettingsCap = validateManifest(
      { ...T2_MANIFEST, capabilities: ['state', 'secrets', 'ui:chat-card'], contributions: { commands: [{ id: 'x:y' }], 'settings-page': [{ id: 'x:settings' }] } },
      { bundled: false, sandboxed: true }
    );
    expect(noSettingsCap.ok).toBe(false);
    expect(noSettingsCap.ok ? '' : noSettingsCap.issues.map((issue) => issue.message).join('; ')).toContain('ui:settings capability');

    const noSecretSlots = validateManifest({ ...T2_MANIFEST, secrets: undefined }, { bundled: false, sandboxed: true });
    expect(noSecretSlots.ok).toBe(false);
    expect(noSecretSlots.ok ? '' : noSecretSlots.issues.map((issue) => issue.message).join('; ')).toContain('declared secret slots');

    const unnamespaced = validateManifest(
      { ...T2_MANIFEST, contributions: { commands: [{ id: 'convert' }] } },
      { bundled: false, sandboxed: true }
    );
    expect(unnamespaced.ok).toBe(false);
    expect(unnamespaced.ok ? '' : unnamespaced.issues.map((issue) => issue.message).join('; ')).toContain('namespaced');

    const tier0CodeStillRejected = validateManifest(T2_MANIFEST, { bundled: false });
    expect(tier0CodeStillRejected.ok).toBe(false);
    expect(tier0CodeStillRejected.ok ? false : tier0CodeStillRejected.issues.some((issue) => issue.path === '$.code' && issue.code === 'reserved')).toBe(true);
  });

  it('source removal parks the install and disables the pack', async () => {
    const { service, transport, registry, read } = createHarness();
    await service.addSource({ local: { path: root }, ref: { strategy: 'tag', value: 'v1' } });
    transport.stage('v1', await writeT2Tree(root));
    const sourceId = (await service.listState()).sources[0].id;
    await service.syncSource(sourceId);
    await service.installExtension(sourceId, 'refpack', true);
    await registry.setEnabled('refpack', true);
    expect(registry.getState().packs[0].enabled).toBe(true);
    await service.removeSource(sourceId);
    const install = read().sourceInstalls?.[0];
    expect(install?.parked).toMatchObject({ reason: 'source removed' });
    expect(registry.getState().packs[0].enabled).toBe(false);
  });
});
