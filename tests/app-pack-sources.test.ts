import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionSourcesService } from '@main/apps/sources/lifecycle';
import { ChildGitTransport, latestTag } from '@main/apps/sources/transport';
import { validateSourceDescriptor } from '@main/apps/sources/descriptor';
import { manifestDiff, discoverManifests } from '@main/apps/sources/lifecycle';
import { projectEnvelope } from '@shared/app-pack/mapping';
import { MiniAppRegistry } from '@main/apps/registry';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import type { GitTransport, ResolvedRef } from '@main/apps/sources/transport';
import type { MiniAppSourceRecord, SourceInstallRecord } from '@shared/app-pack';
import { ENVELOPE_SCHEMA } from '@shared/app-pack';
import { checkSchema } from '@shared/app-pack/schemaCheck';

// ------------------------------------------------------------------ fixtures

function envelopeFixture(mutate: (envelope: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const envelope = {
    apiVersion: 1,
    kind: 'mini-app',
    packKind: 'assessment',
    id: 'sample-review',
    version: '0.1.0',
    author: 'Test Author',
    license: 'MIT',
    description: 'Envelope fixture for the sources pipeline.',
    capabilities: ['fs-read', 'decision', 'run', 'report'],
    privacy: { sendsContent: false, sensitiveGlobs: ['*.key'] },
    run: {
      scan: { excludeGlobs: ['**/.git/**'], maxDepth: 16 },
      classify: {
        veto: [{ id: 'exceptions', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.exceptions' } }],
        keep: [{ id: 'fresh', when: { signal: 'meta.ageDays', op: 'lt', valueSignal: 'config.freshdays' } }],
        candidate: [{ id: 'cache', when: { signal: 'meta.path', op: 'matches', value: 'node_modules/**' } }],
      },
      decide: { questions: [{ id: 'safe', type: 'noul', instructions: 'Is this file safe to delete?' }] },
      compose: { candidateWhen: { signal: 'answer.safe.confidence', op: 'gte', value: 0.8 } },
    },
    report: {
      nodes: [
        { id: 'total', type: 'stat', bind: 'totals.bytes' },
        { id: 'items', type: 'table', columns: ['path', 'verdict', 'confidence'] },
        { id: 'ev', type: 'evidence' },
        { id: 'acts', type: 'actions', actions: ['run:export'] },
      ],
    },
    configSchema: {
      type: 'object',
      properties: {
        freshdays: { type: 'number', default: 7, minimum: 0, maximum: 365 },
        exceptions: { type: 'array', items: { type: 'string' }, default: [] },
      },
    },
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          title: 'Sample review',
          'config.freshdays': 'Fresh window (days)',
          'config.exceptions': 'Exception globs',
          'rule.exceptions': 'On the exception list',
          'rule.fresh': 'Recently modified',
          'rule.cache': 'Build cache',
          'report.total': 'Total size',
          'report.items': 'Items',
          'report.ev': 'Evidence',
        },
      },
    },
  };
  mutate(envelope);
  return envelope;
}

async function writeTree(root: string, manifests: Record<string, unknown>, subdirs: string[] = []): Promise<string> {
  const tree = join(root, 'tree');
  await mkdir(tree, { recursive: true });
  await writeFile(join(tree, 'manifest.json'), JSON.stringify(manifests, null, 2));
  for (const subdir of subdirs) {
    await mkdir(join(tree, subdir), { recursive: true });
    await writeFile(join(tree, subdir, 'manifest.json'), JSON.stringify(manifests, null, 2));
  }
  return tree;
}

class FakeTransport implements GitTransport {
  private refs: string[] = [];
  private trees: string[] = [];
  private lastTree: string | null = null;
  private lastRef = 'v1.0.0';

  stage(ref: string, tree: string): void {
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
    await cp(tree, dest, { recursive: true });
  }

  async tempRoot(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'da-ext-test-'));
  }
}

interface Harness {
  service: ExtensionSourcesService;
  transport: FakeTransport;
  read(): AppConfig['miniApps'];
  packsDir: string;
}

function createHarness(): Harness {
  let config: AppConfig = structuredClone(DEFAULT_CONFIG);
  const packsDir = join(tmpdir(), `da-ext-packs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    registry,
    transport,
    contentRoot: () => packsDir,
    secretStore: {
      get: async () => null,
      set: async () => undefined,
    },
    newId: (() => {
      let counter = 0;
      return () => `src-${(counter += 1)}`;
    })(),
    now: () => 1_700_000_000_000,
    sha256: (input) => createHash('sha256').update(input).digest('hex'),
  });
  return { service, transport, read: () => config.miniApps, packsDir };
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'da-ext-src-test-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

// ------------------------------------------------------------- the envelope

describe('family-envelope → pack-manifest projection (the explicit mapping)', () => {
  it('projects a valid assessment envelope onto a pack manifest the shared validator accepts', async () => {
    const { validateManifest } = await import('@shared/app-pack/validate');
    const envelope = envelopeFixture();
    const schemaVerdict = checkSchema(ENVELOPE_SCHEMA, envelope);
    expect(schemaVerdict.ok, schemaVerdict.ok ? '' : JSON.stringify(schemaVerdict.issues)).toBe(true);
    const projection = projectEnvelope(envelope);
    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.manifest.kind).toBe('assessment');
    expect(projection.manifest.author).toBeUndefined();
    expect(projection.manifest.packKind).toBeUndefined();
    const locales = (projection.manifest.i18n as { locales: Record<string, Record<string, string>> }).locales;
    expect(locales.en.description).toBe('Envelope fixture for the sources pipeline.');
    const verdict = validateManifest(projection.manifest, { bundled: false });
    expect(verdict.ok, verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')).toBe(true);
  });

  it('rejects connector/bridge kinds with the hosted-kind reason', () => {
    const rejection = projectEnvelope(envelopeFixture((envelope) => Object.assign(envelope, { kind: 'connector', apiVersion: 'extension/v1', packKind: undefined })));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('not hosted for import');
    }
  });

  it('rejects an apiVersion too new with the self-disable-style reason (adversarial wall)', () => {
    const rejection = projectEnvelope(envelopeFixture((envelope) => Object.assign(envelope, { apiVersion: 2 })));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('too new');
      expect(rejection.reason).toContain('self-disable');
    }
  });

  it("rejects net as the exfiltration class at T0 (never an unknown-capability reason)", () => {
    const rejection = projectEnvelope(
      envelopeFixture((envelope) => {
        (envelope.capabilities as string[]).push('net');
        Object.assign(envelope, { domains: ['example.com'] });
      })
    );
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('exfiltration');
    }
  });

  it('self-disables on unhonored capabilities, naming the id and the honored set (adversarial wall)', () => {
    for (const capability of ['ui:page', 'ui:panel', 'chat-tools', 'secrets', 'sync', 'ui:chat-card', 'ui:settings', 'notify', 'state']) {
      const rejection = projectEnvelope(
        envelopeFixture((envelope) => {
          (envelope.capabilities as string[]).push(capability);
        })
      );
      expect(rejection.ok, `capability '${capability}' must not project`).toBe(false);
      if (!rejection.ok) {
        expect(rejection.reason).toContain(`'${capability}'`);
        expect(rejection.reason).toContain('not honored');
      }
    }
  });

  it('self-disables career-style surface envelopes (surfaces/data blocks, page→panel degrade chain)', () => {
    const pageEnvelope = envelopeFixture((envelope) => {
      Object.assign(envelope, {
        packKind: 'surface',
        capabilities: ['report'],
        run: undefined,
        privacy: undefined,
        report: undefined,
        surfaces: { page: { nodes: [{ id: 'main', type: 'cards', of: 'items' }] } },
        data: { rows: [{ name: 'x' }] },
      });
    });
    const rejection = projectEnvelope(pageEnvelope);
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('surfaces.page');
      expect(rejection.reason).toContain('page→panel');
    }
  });

  it('rejects x-secret config fields (the pack-config store is not a secret store, D19)', () => {
    const rejection = projectEnvelope(
      envelopeFixture((envelope) => {
        (envelope.configSchema as { properties: Record<string, unknown> }).properties.token = { type: 'string', 'x-secret': true };
      })
    );
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('x-secret');
    }
  });

  it('rejects configSchema.required with the re-author reason (never converted, D15)', () => {
    const rejection = projectEnvelope(
      envelopeFixture((envelope) => {
        Object.assign(envelope.configSchema, { required: ['freshdays'] });
      })
    );
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('re-author');
    }
  });
});

// ------------------------------------------------------------- descriptors

describe('source descriptor validation (adversarial wall)', () => {
  it('rejects an inline token in the URL structurally (no @ anywhere)', () => {
    const verdict = validateSourceDescriptor({
      url: 'https://user:ghp_secrettoken@git.example.com/ext/repo',
      ref: { strategy: 'release-tag' },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error).toContain('structurally invalid');
    }
  });

  it('rejects a credential VALUE field (slot references only, D22)', () => {
    const verdict = validateSourceDescriptor({
      url: 'https://git.example.com/ext/repo',
      ref: { strategy: 'release-tag' },
      credentials: [{ slot: 'repo-token', value: 'ghp_inline' }],
    });
    expect(verdict.ok).toBe(false);
  });

  it('rejects ssh:// and other non-https transports', () => {
    const verdict = validateSourceDescriptor({ url: 'ssh://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    expect(verdict.ok).toBe(false);
  });

  it('rejects subpath traversal', () => {
    const verdict = validateSourceDescriptor({
      url: 'https://git.example.com/ext/repo',
      ref: { strategy: 'release-tag' },
      subpath: 'a/../b',
    });
    expect(verdict.ok).toBe(false);
  });

  it('denies local traversal and relative paths', () => {
    const traversal = validateSourceDescriptor({ local: { path: '/repos/../secrets' }, ref: { strategy: 'release-tag' } });
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) {
      expect(traversal.error.toLowerCase()).toMatch(/invalid|absolute/);
    }
    const relative = validateSourceDescriptor({ local: { path: 'repos/ext' }, ref: { strategy: 'release-tag' } });
    expect(relative.ok).toBe(false);
    if (!relative.ok) {
      expect(relative.error.toLowerCase()).toMatch(/invalid|absolute/);
    }
  });

  it('the local variant never validates against the production root', () => {
    const verdict = validateSourceDescriptor({ url: 'https://git.example.com/ext/repo', local: { path: '/repos/ext' }, ref: { strategy: 'release-tag' } });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.error).toContain('either https or local');
    }
  });

  it('accepts a valid git descriptor and a valid local descriptor', () => {
    const git = validateSourceDescriptor({
      url: 'https://git.example.com/ext/repo',
      ref: { strategy: 'tag-pattern', value: 'v*' },
      subpath: 'packs',
    });
    expect(git.ok).toBe(true);
    const local = validateSourceDescriptor({ local: { path: '/repos/ext' }, ref: { strategy: 'branch', value: 'main' } });
    expect(local.ok).toBe(true);
  });
});

// ---------------------------------------------------------------- updates

describe('update engine (D15/D22)', () => {
  it('marks byte-identical-manifest data diffs as the ONLY auto-apply window', () => {
    const installed = { version: '1.0.0', capabilities: ['fs-read', 'run'], configSchema: { type: 'object', properties: {} } };
    const same = manifestDiff(installed, { capabilities: ['fs-read', 'run'], configSchema: { type: 'object', properties: {} }, version: '1.1.0' });
    expect(same.capabilitiesAdded).toEqual([]);
    expect(same.configSchemaChanged).toBe(false);
    const grown = manifestDiff(installed, { capabilities: ['fs-read', 'run', 'report'], configSchema: { type: 'object', properties: {} }, version: '1.2.0' });
    expect(grown.capabilitiesAdded).toEqual(['report']);
  });

  it('orders tags by semver then name (career parity)', () => {
    expect(latestTag(['v1.10.0', 'v1.9.0', 'v0.1.0'])).toBe('v1.10.0');
    expect(latestTag(['nightly-b', 'nightly-a'])).toBe('nightly-b');
    expect(latestTag([])).toBeNull();
  });
});

// ----------------------------------------------------------- the pipeline

describe('the sources pipeline (one code path for git + local sources)', () => {
  it('add → sync → consent → install lands a pinned, content-addressed, DISABLED pack', async () => {
    const harness = createHarness();
    const tree = await writeTree(scratch, envelopeFixture());
    harness.transport.stage('v1.0.0', tree);
    const added = await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    expect(added.ok).toBe(true);

    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok, JSON.stringify(synced)).toBe(true);
    if (!synced.ok) {
      return;
    }
    expect(synced.candidates).toHaveLength(1);
    expect(synced.candidates[0].compatible).toBe(true);
    expect(synced.candidates[0].consent.provenance.author).toBe('Test Author');
    expect(synced.candidates[0].consent.disclosure.length).toBeGreaterThan(40);
    expect(synced.updates).toEqual([]);

    const refused = await harness.service.installExtension('src-1', 'sample-review', false);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('Consent is required');
    }

    const installed = await harness.service.installExtension('src-1', 'sample-review', true);
    expect(installed.ok, installed.ok ? '' : installed.error).toBe(true);
    const packs = harness.read().packs;
    expect(packs).toHaveLength(1);
    expect(packs[0].enabled).toBe(false);
    expect(packs[0].origin.kind).toBe('imported');
    const installs = harness.read().sourceInstalls ?? [];
    expect(installs).toHaveLength(1);
    expect(installs[0].pinRef).toBe('v1.0.0');
    expect(installs[0].consents).toHaveLength(1);
    expect(installs[0].consents[0].actor).toBe('user');
    const contentFile = join(installs[0].contentPath, 'manifest.json');
    expect(existsSync(contentFile)).toBe(true);
    expect(JSON.parse(await readFile(contentFile, 'utf8')).id).toBe('sample-review');
    expect(installs[0].digest).toBe(createHash('sha256').update(JSON.stringify(packs[0].manifest)).digest('hex'));
  });

  it('sync discovers manifests in root + one-level child dirs', async () => {
    const withChild = join(scratch, 'with-child');
    await mkdir(withChild, { recursive: true });
    await writeFile(join(withChild, 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { id: 'root-pack' }))));
    await mkdir(join(withChild, 'child-pack'), { recursive: true });
    await writeFile(join(withChild, 'child-pack', 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { id: 'child-pack' }))));
    const found = await discoverManifests(withChild, '');
    expect(found.map((entry) => entry.extensionId).sort()).toEqual(['child-pack', 'root-pack']);
    const scoped = await discoverManifests(withChild, 'child-pack');
    expect(scoped.map((entry) => entry.extensionId)).toEqual(['child-pack']);
  });

  it('a failed fetch marks the source failing and leaves pins untouched (D22)', async () => {
    const harness = createHarness();
    const tree = await writeTree(scratch, envelopeFixture());
    harness.transport.stage('v1.0.0', tree);
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', true);
    const before = harness.read().sourceInstalls?.[0];

    await mkdir(join(scratch, 'empty', 'tree'), { recursive: true });
    harness.transport.stage('v1.0.1', join(scratch, 'empty'));
    const failed = await harness.service.syncSource('src-1');
    expect(failed.ok).toBe(false);
    const source = harness.read().sources?.[0];
    expect(source?.status).toBe('failing');
    expect(source?.consecutiveFailures).toBe(1);
    expect(harness.read().sourceInstalls?.[0]).toEqual(before);
  });

  it('incompatible candidates carry the host-profile reason and cannot install (never half-install)', async () => {
    const harness = createHarness();
    const tree = await writeTree(scratch, envelopeFixture((envelope) => (envelope.capabilities as string[]).push('ui:panel')));
    harness.transport.stage('v1.0.0', tree);
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    if (!synced.ok) {
      return;
    }
    expect(synced.candidates[0].compatible).toBe(false);
    expect(synced.candidates[0].reason).toContain('ui:panel');
    const refused = await harness.service.installExtension('src-1', 'sample-review', true);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('not hostable');
    }
    expect(harness.read().packs).toHaveLength(0);
  });

  it('digest drift on a pinned ref is a LOUD failure — never a silent refetch (adversarial wall)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', true);

    harness.transport.stage('v1.0.0', await writeTree(join(scratch, 'moved'), envelopeFixture((envelope) => Object.assign(envelope, { version: '9.9.9' }))));
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    expect(install?.update?.state).toBe('digest-drift');
    expect(install?.digest).not.toContain('drift');
    expect(install?.pinRef).toBe('v1.0.0');
    const source = harness.read().sources?.[0];
    expect(source?.status).toBe('degraded');

    const blocked = await harness.service.applyUpdate('src-1', 'sample-review', true);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain('No update is available');
    }
  });

  it('capability growth without re-consent is blocked; consent applies with a reconsent record (adversarial wall)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', true);

    harness.transport.stage('v1.1.0', await writeTree(join(scratch, 'grown'), envelopeFixture((envelope) => {
      (envelope.capabilities as string[]).push('propose');
      Object.assign(envelope, { version: '0.2.0' });
    })));
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    expect(install?.update?.state).toBe('available');
    if (install?.update?.state !== 'available') {
      return;
    }
    expect(install.update.requiresReconsent).toBe(true);
    expect(install.update.manifestDiff.capabilitiesAdded).toEqual(['propose']);

    const blocked = await harness.service.applyUpdate('src-1', 'sample-review', false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain('re-consent');
    }
    const stillOld = harness.read().packs[0].manifest as { version?: string };
    expect(stillOld.version).toBe('0.1.0');

    const applied = await harness.service.applyUpdate('src-1', 'sample-review', true);
    expect(applied.ok, applied.ok ? '' : applied.error).toBe(true);
    const after = harness.read().sourceInstalls?.[0];
    expect(after?.consents).toHaveLength(2);
    expect(after?.consents[1].reconsent).toBe(true);
    const upgraded = harness.read().packs[0].manifest as { version?: string };
    expect(upgraded.version).toBe('0.2.0');
    const grownCaps = harness.read().packs[0].manifest as { capabilities?: string[] };
    expect(grownCaps.capabilities).toContain('propose');
  });

  it('a byte-identical-manifest data diff auto-applies without consent (the D22 window)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', true);

    harness.transport.stage('v1.0.1', await writeTree(join(scratch, 'bumped'), envelopeFixture((envelope) => Object.assign(envelope, { version: '0.1.1' }))));
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    if (install?.update?.state !== 'available') {
      throw new Error(`expected an available update, got ${JSON.stringify(install?.update)}`);
    }
    expect(install.update.requiresReconsent).toBe(false);

    const applied = await harness.service.applyUpdate('src-1', 'sample-review', false);
    expect(applied.ok, applied.ok ? '' : applied.error).toBe(true);
    const upgraded = harness.read().packs[0].manifest as { version?: string };
    expect(upgraded.version).toBe('0.1.1');
    const after = harness.read().sourceInstalls?.[0];
    expect(after?.pinRef).toBe('v1.0.1');
  });

  it('installing over a consented digest that moved mid-install fails loud', async () => {
    const harness = createHarness();
    const treeA = await writeTree(join(scratch, 'a'), envelopeFixture());
    harness.transport.stage('v1.0.0', treeA);
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');

    harness.transport.stage('v1.0.0', await writeTree(join(scratch, 'b'), envelopeFixture((envelope) => Object.assign(envelope, { version: '0.2.0' }))));
    const refused = await harness.service.installExtension('src-1', 'sample-review', true);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('no longer matches the digest');
    }
    expect(harness.read().packs).toHaveLength(0);
  });

  it('removing a source parks its installs (disabled, data intact) and restore unparks', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', true);

    const removed = await harness.service.removeSource('src-1');
    expect(removed.ok).toBe(true);
    expect(harness.read().sources).toHaveLength(0);
    const install = harness.read().sourceInstalls?.[0];
    expect(install?.parked?.reason).toBe('source removed');
    expect(harness.read().packs).toHaveLength(1);
    expect(harness.read().packs[0].enabled).toBe(false);

    const state = await harness.service.listState();
    expect(state.installs[0].parked).toBe(true);

    const restored = await harness.service.restoreExtension('sample-review');
    expect(restored.ok).toBe(true);
    expect(harness.read().sourceInstalls?.[0]?.parked).toBeUndefined();
    expect(harness.read().packs[0].manifest).toBeDefined();
  });

  it('duplicate origins are refused', async () => {
    const harness = createHarness();
    const added = await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    expect(added.ok).toBe(true);
    const again = await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'branch', value: 'main' } });
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.error).toContain('already exists');
    }
  });
});

// -------------------------------------------------- the real git transport

describe('ChildGitTransport against a real local git repo (the constrained shallow path)', () => {
  const GIT_AVAILABLE = existsSync('/usr/bin/git') || existsSync('/usr/local/bin/git');

  it('resolves a tag and shallow-fetches the tree', async () => {
    if (!GIT_AVAILABLE) {
      return;
    }
    const repo = join(scratch, 'real-repo');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, 'manifest.json'), JSON.stringify(envelopeFixture()));
    const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['add', '.']);
    git(['commit', '-qm', 'init']);
    git(['tag', 'v1.0.0']);

    const transport = new ChildGitTransport();
    const resolved = await transport.resolve(repo, { strategy: 'release-tag' });
    expect(resolved.ref).toBe('v1.0.0');
    const root = await transport.tempRoot();
    try {
      const dest = join(root, 'tree');
      await transport.fetch(repo, resolved, dest);
      const found = await discoverManifests(dest, '');
      expect(found).toHaveLength(1);
      expect(found[0].extensionId).toBe('sample-review');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses unresolvable branch names with not-found', async () => {
    if (!GIT_AVAILABLE) {
      return;
    }
    const repo = join(scratch, 'real-repo-2');
    await mkdir(repo, { recursive: true });
    const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['add', '.']);
    git(['commit', '-qm', 'init', '--allow-empty']);
    const transport = new ChildGitTransport();
    await expect(transport.resolve(repo, { strategy: 'branch', value: 'nope' })).rejects.toThrow(/not found/i);
  });

  it('keeps source strings out of the shell (argv arrays only)', async () => {
    const transport = new ChildGitTransport();
    const evil = 'main; rm -rf /; echo pwned';
    if (!GIT_AVAILABLE) {
      return;
    }
    const repo = join(scratch, 'real-repo-3');
    await mkdir(repo, { recursive: true });
    const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['commit', '-qm', 'init', '--allow-empty']);
    await expect(transport.resolve(repo, { strategy: 'branch', value: evil })).rejects.toThrow();
  });
});

// -------------------------------------------------------------- shape misc

describe('source records round-trip the config sanitizer shape', () => {
  it('candidates carry consent payloads the renderer can render without manifest access', () => {
    const candidate: MiniAppSourceRecord['candidates'][number] = {
      extensionId: 'x',
      subpath: '',
      digest: 'a'.repeat(64),
      ref: 'v1.0.0',
      compatible: true,
      consent: {
        extensionId: 'x',
        version: '1.0.0',
        subpath: '',
        digest: 'a'.repeat(64),
        tier: 'T0',
        importClass: 'imported',
        originClass: 'imported',
        capabilities: ['fs-read'],
        provenance: { author: 'A', license: 'MIT', repository: 'https://git.example.com/x' },
        disclosure: 'd',
      },
    };
    expect(candidate.consent.originClass).toBe('imported');
    expect(candidate.consent.tier).toBe('T0');
  });

  it('install records keep the consent history immutable by shape', () => {
    const record: SourceInstallRecord = {
      extensionId: 'x',
      sourceId: 's',
      subpath: '',
      version: '1.0.0',
      digest: 'a'.repeat(64),
      pinRef: 'v1.0.0',
      refHistory: [{ ref: 'v1.0.0', digest: 'a'.repeat(64), at: 1 }],
      consents: [],
      provenance: {},
      contentPath: '/data/mini-apps/x/a',
    };
    expect(record.refHistory).toHaveLength(1);
  });
});
