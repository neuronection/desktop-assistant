import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { ExtensionSourcesService } from '@main/apps/sources/lifecycle';
import { ChildGitTransport, gitChildEnv, latestTag } from '@main/apps/sources/transport';
import { validateSourceDescriptor } from '@main/apps/sources/descriptor';
import { manifestDiff, discoverManifests, digestTree } from '@main/apps/sources/lifecycle';
import { projectImportedEnvelope } from '@shared/app-pack/mapping';
import { MiniAppRegistry } from '@main/apps/registry';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import type { GitTransport, ResolvedRef } from '@main/apps/sources/transport';
import type { ConsentEcho, MiniAppSourceRecord, SourceInstallRecord } from '@shared/app-pack';
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

function createHarness(
  options: { localSourcesAllowed?: () => boolean; localSourceRoots?: () => readonly string[] } = {}
): Harness {
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
    localSourcesAllowed: options.localSourcesAllowed ?? (() => true),
    localSourceRoots: options.localSourceRoots ?? (() => [scratch]),
  });
  return { service, transport, read: () => config.miniApps, packsDir };
}

function consentEchoOf(harness: Harness, sourceId = 'src-1'): ConsentEcho {
  const candidate = harness.read().sources?.find((source) => source.id === sourceId)?.candidates[0];
  return { digest: candidate?.consent.digest ?? '', capabilities: candidate?.consent.capabilities ?? [], version: candidate?.consent.version ?? '' };
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
    const projection = projectImportedEnvelope(envelope);
    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.manifest.kind).toBe('assessment');
    expect(projection.manifest.packKind).toBeUndefined();
    const locales = (projection.manifest.i18n as { locales: Record<string, Record<string, string>> }).locales;
    expect(locales.en.description).toBe('Envelope fixture for the sources pipeline.');
    const verdict = validateManifest(projection.manifest, { bundled: false });
    expect(verdict.ok, verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')).toBe(true);
  });

  it('passes the envelope-shared metadata through — provenance, categories and the docs pointer survive the projection (2026-10-19 field adoption)', async () => {
    const { validateManifest } = await import('@shared/app-pack/validate');
    const envelope = envelopeFixture((env) =>
      Object.assign(env, {
        repository: 'https://github.com/neuronection/desktop-assistant',
        categories: ['files', 'utilities'],
        docs: 'docs/docs-tree.json',
      })
    );
    expect(checkSchema(ENVELOPE_SCHEMA, envelope).ok).toBe(true);
    const projection = projectImportedEnvelope(envelope);
    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.manifest.author).toBe('Test Author');
    expect(projection.manifest.license).toBe('MIT');
    expect(projection.manifest.repository).toBe('https://github.com/neuronection/desktop-assistant');
    expect(projection.manifest.categories).toEqual(['files', 'utilities']);
    expect(projection.manifest.docs).toBe('docs/docs-tree.json');
    const verdict = validateManifest(projection.manifest, { bundled: false });
    expect(verdict.ok, verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')).toBe(true);
  });

  it('rejects connector/bridge kinds with the hosted-kind reason', () => {
    const rejection = projectImportedEnvelope(envelopeFixture((envelope) => Object.assign(envelope, { kind: 'connector', apiVersion: 'extension/v1', packKind: undefined })));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('not hosted for import');
    }
  });

  it('rejects an apiVersion too new with the self-disable-style reason (adversarial wall)', () => {
    const rejection = projectImportedEnvelope(envelopeFixture((envelope) => Object.assign(envelope, { apiVersion: 2 })));
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('too new');
      expect(rejection.reason).toContain('self-disable');
    }
  });

  it("rejects net as the exfiltration class at T0 (never an unknown-capability reason)", () => {
    const rejection = projectImportedEnvelope(
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
      const rejection = projectImportedEnvelope(
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
    const rejection = projectImportedEnvelope(pageEnvelope);
    expect(rejection.ok).toBe(false);
    if (!rejection.ok) {
      expect(rejection.reason).toContain('surfaces.page');
      expect(rejection.reason).toContain('page→panel');
    }
  });

  it('rejects x-secret config fields (the pack-config store is not a secret store, D19)', () => {
    const rejection = projectImportedEnvelope(
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
    const rejection = projectImportedEnvelope(
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

describe('update engine (D15/D22, plan 37 §3.3)', () => {
  const installed = {
    version: '1.0.0',
    capabilities: ['fs-read', 'run'],
    configSchema: { type: 'object', properties: {} },
    i18n: { defaultLocale: 'en', locales: { en: { title: 'Pack' } } },
    report: { nodes: [{ id: 'total', type: 'stat', bind: 'totals.bytes' }] },
    author: 'A',
  };

  it('a byte-identical manifest is the ONLY auto-apply condition', () => {
    const same = manifestDiff(installed, structuredClone(installed));
    expect(same.byteIdentical).toBe(true);
    expect(same.changed).toEqual([]);
    expect(same.capabilitiesAdded).toEqual([]);
    expect(same.configSchemaChanged).toBe(false);
  });

  it('every canonical-manifest family names itself in the change summary (version, labels, report, provenance, …)', () => {
    const versionOnly = manifestDiff(installed, { ...structuredClone(installed), version: '1.1.0' });
    expect(versionOnly.byteIdentical).toBe(false);
    expect(versionOnly.changed).toEqual(['version']);
    expect(versionOnly.capabilitiesAdded).toEqual([]);
    expect(versionOnly.configSchemaChanged).toBe(false);

    const relabeled = manifestDiff(installed, {
      ...structuredClone(installed),
      i18n: { defaultLocale: 'en', locales: { en: { title: 'Renamed pack' } } },
    });
    expect(relabeled.changed).toEqual(['i18n']);

    const reconfigured = manifestDiff(installed, {
      ...structuredClone(installed),
      configSchema: { type: 'object', properties: { freshdays: { type: 'number' } } },
    });
    expect(reconfigured.changed).toEqual(['configSchema']);
    expect(reconfigured.configSchemaChanged).toBe(true);

    const reprovenanced = manifestDiff(installed, { ...structuredClone(installed), author: 'B' });
    expect(reprovenanced.changed).toEqual(['provenance']);

    const reportChanged = manifestDiff(installed, {
      ...structuredClone(installed),
      report: { nodes: [{ id: 'ev', type: 'evidence' }] },
    });
    expect(reportChanged.changed).toEqual(['report']);

    const dataChanged = manifestDiff(installed, { ...structuredClone(installed), data: { rows: [] } });
    expect(dataChanged.changed).toEqual(['data']);

    const unknownField = manifestDiff(installed, { ...structuredClone(installed), privacy: { sendsContent: true } });
    expect(unknownField.changed).toEqual(['other']);

    const grown = manifestDiff(installed, {
      ...structuredClone(installed),
      version: '1.2.0',
      capabilities: ['fs-read', 'run', 'report'],
    });
    expect(grown.byteIdentical).toBe(false);
    expect(grown.capabilitiesAdded).toEqual(['report']);
    expect(grown.changed).toEqual(['version', 'capabilities']);
  });

  it('no installed baseline is never an auto-apply window', () => {
    const diff = manifestDiff(null, structuredClone(installed));
    expect(diff.byteIdentical).toBe(false);
    expect(diff.changed).toEqual(['other']);
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

    const refused = await harness.service.installExtension('src-1', 'sample-review', true as unknown as ConsentEcho);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('Consent');
    }

    const installed = await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));
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
    expect(installs[0].digest).toBe(digestTree(tree));
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

  it('a manifest with the docs pointer discovers only when the tree exists and validates (plan 34 §10.5 — broken promise = invalid)', async () => {
    const docsTree = {
      version: 1,
      categories: [
        { category: 'overview', items: [{ id: 'overview', file: 'overview.md', title: 'Overview', description: 'What it is.', audience: 'user' }] },
      ],
    };
    const withDocs = join(scratch, 'with-docs');
    await mkdir(join(withDocs, 'docs'), { recursive: true });
    await writeFile(join(withDocs, 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { docs: 'docs/docs-tree.json' }))));
    await writeFile(join(withDocs, 'docs', 'docs-tree.json'), JSON.stringify(docsTree));
    await writeFile(join(withDocs, 'docs', 'overview.md'), '# Overview\n');
    const found = await discoverManifests(withDocs, '');
    expect(found.map((entry) => entry.extensionId)).toEqual(['sample-review']);

    const noTree = join(scratch, 'no-tree');
    await mkdir(noTree, { recursive: true });
    await writeFile(join(noTree, 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { docs: 'docs/docs-tree.json' }))));
    await expect(discoverManifests(noTree, '')).rejects.toThrow(/tree does not exist/);

    const brokenTree = join(scratch, 'broken-tree');
    await mkdir(join(brokenTree, 'docs'), { recursive: true });
    await writeFile(join(brokenTree, 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { docs: 'docs/docs-tree.json' }))));
    await writeFile(join(brokenTree, 'docs', 'docs-tree.json'), JSON.stringify({ version: 1, categories: [{ category: 'getting-started', items: [] }] }));
    await expect(discoverManifests(brokenTree, '')).rejects.toThrow(/docs tree invalid/);

    const missingPage = join(scratch, 'missing-page');
    await mkdir(join(missingPage, 'docs'), { recursive: true });
    await writeFile(join(missingPage, 'manifest.json'), JSON.stringify(envelopeFixture((envelope) => Object.assign(envelope, { docs: 'docs/docs-tree.json' }))));
    await writeFile(join(missingPage, 'docs', 'docs-tree.json'), JSON.stringify(docsTree));
    await expect(discoverManifests(missingPage, '')).rejects.toThrow(/does not resolve/);
  });

  it('a failed fetch marks the source failing and leaves pins untouched (D22)', async () => {
    const harness = createHarness();
    const tree = await writeTree(scratch, envelopeFixture());
    harness.transport.stage('v1.0.0', tree);
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));
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
    const refused = await harness.service.installExtension('src-1', 'sample-review', { digest: 'a'.repeat(64), capabilities: ['fs-read'], version: '1.0.0' });
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
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));

    harness.transport.stage('v1.0.0', await writeTree(join(scratch, 'moved'), envelopeFixture((envelope) => Object.assign(envelope, { version: '9.9.9' }))));
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    expect(install?.update?.state).toBe('digest-drift');
    expect(install?.digest).not.toContain('drift');
    expect(install?.pinRef).toBe('v1.0.0');
    const source = harness.read().sources?.[0];
    expect(source?.status).toBe('degraded');

    const blocked = await harness.service.applyUpdate('src-1', 'sample-review', null);
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
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));

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
    expect(install.update.manifestDiff.changed).toEqual(['version', 'capabilities']);

    const blocked = await harness.service.applyUpdate('src-1', 'sample-review', null);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain('re-consent');
    }
    const stillOld = harness.read().packs[0].manifest as { version?: string };
    expect(stillOld.version).toBe('0.1.0');

    const applied = await harness.service.applyUpdate('src-1', 'sample-review', consentEchoOf(harness));
    expect(applied.ok, applied.ok ? '' : applied.error).toBe(true);
    const after = harness.read().sourceInstalls?.[0];
    expect(after?.consents).toHaveLength(2);
    expect(after?.consents[1].reconsent).toBe(true);
    const upgraded = harness.read().packs[0].manifest as { version?: string };
    expect(upgraded.version).toBe('0.2.0');
    const grownCaps = harness.read().packs[0].manifest as { capabilities?: string[] };
    expect(grownCaps.capabilities).toContain('propose');
  });

  it('a byte-identical-manifest content change auto-applies without consent (the D22 window)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));

    // Non-manifest content moves (a docs/data file): the tree digest changes,
    // the canonical manifest does not — the ONLY auto-apply window.
    const sameManifest = join(scratch, 'fresh-content');
    const tree = await writeTree(sameManifest, envelopeFixture());
    await writeFile(join(tree, 'notes.txt'), 'content-only change\n');
    harness.transport.stage('v1.0.1', tree);
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    if (install?.update?.state !== 'available') {
      throw new Error(`expected an available update, got ${JSON.stringify(install?.update)}`);
    }
    expect(install.update.manifestDiff.byteIdentical).toBe(true);
    expect(install.update.manifestDiff.changed).toEqual([]);
    expect(install.update.requiresReconsent).toBe(false);

    const applied = await harness.service.applyUpdate('src-1', 'sample-review', null);
    expect(applied.ok, applied.ok ? '' : applied.error).toBe(true);
    expect((harness.read().packs[0].manifest as { version?: string }).version).toBe('0.1.0');
    const after = harness.read().sourceInstalls?.[0];
    expect(after?.pinRef).toBe('v1.0.1');
    expect(after?.digest).toBe(digestTree(tree));
    expect(after?.consents.at(-1)?.reconsent).toBeUndefined();
  });

  it('a version-only manifest bump re-consents — a changed manifest is never auto-applied (plan 37 §3.3)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));

    harness.transport.stage('v1.0.1', await writeTree(join(scratch, 'bumped'), envelopeFixture((envelope) => Object.assign(envelope, { version: '0.1.1' }))));
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok).toBe(true);
    const install = harness.read().sourceInstalls?.[0];
    if (install?.update?.state !== 'available') {
      throw new Error(`expected an available update, got ${JSON.stringify(install?.update)}`);
    }
    expect(install.update.manifestDiff.byteIdentical).toBe(false);
    expect(install.update.manifestDiff.changed).toEqual(['version']);
    expect(install.update.requiresReconsent).toBe(true);

    const refused = await harness.service.applyUpdate('src-1', 'sample-review', null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('re-consent');
    }
    expect((harness.read().packs[0].manifest as { version?: string }).version).toBe('0.1.0');

    const applied = await harness.service.applyUpdate('src-1', 'sample-review', consentEchoOf(harness));
    expect(applied.ok, applied.ok ? '' : applied.error).toBe(true);
    expect((harness.read().packs[0].manifest as { version?: string }).version).toBe('0.1.1');
  });

  it('installing over a consented digest that moved mid-install fails loud', async () => {
    const harness = createHarness();
    const treeA = await writeTree(join(scratch, 'a'), envelopeFixture());
    harness.transport.stage('v1.0.0', treeA);
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');

    harness.transport.stage('v1.0.0', await writeTree(join(scratch, 'b'), envelopeFixture((envelope) => Object.assign(envelope, { version: '0.2.0' }))));
    const refused = await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));
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
    await harness.service.installExtension('src-1', 'sample-review', consentEchoOf(harness));

    const removed = await harness.service.removeSource('src-1');
    expect(removed.ok).toBe(true);
    expect(harness.read().sources ?? []).toHaveLength(0);
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

// ----------------------------------------- the git child env + auth posture (F24)

describe('git child environment is an allowlist and the bearer is origin-bound (F24)', () => {
  it('never inherits GIT_*/LD_*/DYLD_* or the host git config', () => {
    const env = gitChildEnv(null, 'https://git.example.com/ext/repo', {
      PATH: '/usr/bin',
      HOME: '/home/user',
      GIT_SSH_COMMAND: 'evil-ssh -o ProxyCommand=evil',
      GIT_PROXY_COMMAND: 'evil-proxy',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: Bearer stolen',
      GIT_DIR: '/tmp/evil',
      LD_PRELOAD: '/tmp/evil.so',
      DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
      BASH_ENV: '/tmp/evil.sh',
      NODE_OPTIONS: '--require /tmp/evil.js',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    for (const key of [
      'GIT_SSH_COMMAND',
      'GIT_PROXY_COMMAND',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_KEY_0',
      'GIT_CONFIG_VALUE_0',
      'GIT_DIR',
      'LD_PRELOAD',
      'DYLD_INSERT_LIBRARIES',
      'BASH_ENV',
      'NODE_OPTIONS',
    ]) {
      expect(env[key], `${key} must not reach the git child`).toBeUndefined();
    }
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_CONFIG_GLOBAL).not.toBeUndefined();
  });

  it('binds the bearer to the source origin and forbids redirects', () => {
    const env = gitChildEnv('SEKRET', 'https://git.example.com/ext/repo', {});
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://git.example.com/.extraHeader');
    expect(env.GIT_CONFIG_VALUE_0).toBe('Authorization: Bearer SEKRET');
    expect(env.GIT_CONFIG_KEY_1).toBe('http.followRedirects');
    expect(env.GIT_CONFIG_VALUE_1).toBe('false');
    // Never the unscoped key: a header that applies to every host is the F24b leak.
    expect(env.GIT_CONFIG_KEY_0).not.toBe('http.extraHeader');
  });

  it('refuses to attach a bearer to a non-https origin', () => {
    expect(() => gitChildEnv('SEKRET', '/tmp/repo', {})).toThrow(/https/);
    expect(() => gitChildEnv('SEKRET', 'http://git.example.com/ext/repo', {})).toThrow(/https/);
  });

  it('uses the same scrubbed, bearer-bearing env for ls-remote and fetch (real spawn, argv-free)', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const bin = join(scratch, 'bin');
    await mkdir(bin, { recursive: true });
    const log = join(scratch, 'git-spawn.log');
    const sha = 'a'.repeat(40);
    const script = [
      '#!/bin/sh',
      '{',
      '  echo "ARGV: $*"',
      '  env',
      '  echo "---"',
      `} >> ${JSON.stringify(log)}`,
      'if [ "$1" = "ls-remote" ]; then',
      `  printf '%s\\t%s\\n' "${sha}" "refs/tags/v1.0.0"`,
      'fi',
      'exit 0',
      '',
    ].join('\n');
    await writeFile(join(bin, 'git'), script, { mode: 0o755 });

    const previousPath = process.env.PATH;
    const previousSsh = process.env.GIT_SSH_COMMAND;
    const previousProxy = process.env.GIT_PROXY_COMMAND;
    process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`;
    process.env.GIT_SSH_COMMAND = 'evil-ssh';
    process.env.GIT_PROXY_COMMAND = 'evil-proxy';
    try {
      const transport = new ChildGitTransport();
      const resolved = await transport.resolve('https://git.example.com/ext/repo', { strategy: 'release-tag' }, 'SEKRET');
      expect(resolved.ref).toBe('v1.0.0');
      await transport.fetch('https://git.example.com/ext/repo', resolved, join(scratch, 'dest'), 'SEKRET');
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
      if (previousSsh === undefined) {
        delete process.env.GIT_SSH_COMMAND;
      } else {
        process.env.GIT_SSH_COMMAND = previousSsh;
      }
      if (previousProxy === undefined) {
        delete process.env.GIT_PROXY_COMMAND;
      } else {
        process.env.GIT_PROXY_COMMAND = previousProxy;
      }
    }

    const logged = await readFile(log, 'utf8');
    const invocations = logged.split('\n---').filter((block) => block.trim().length > 0);
    expect(invocations).toHaveLength(2); // ls-remote + clone, one env policy
    expect(logged).toContain('GIT_CONFIG_KEY_0=http.https://git.example.com/.extraHeader');
    expect(logged).toContain('GIT_CONFIG_NOSYSTEM=1');
    expect(logged.match(/GIT_CONFIG_VALUE_0=Authorization: Bearer SEKRET/g)).toHaveLength(2);
    expect(logged.match(/GIT_CONFIG_VALUE_1=false/g)).toHaveLength(2);
    expect(logged).not.toContain('GIT_SSH_COMMAND');
    expect(logged).not.toContain('GIT_PROXY_COMMAND');
    for (const line of logged.split('\n')) {
      if (line.startsWith('ARGV: ')) {
        expect(line).not.toContain('SEKRET');
      }
    }
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

// ------------------------------------------- consent verification (H4 wall)

describe('consent is main-verified, never renderer-asserted (H4)', () => {
  type ConsentParam = Parameters<typeof ExtensionSourcesService.prototype.installExtension>[2];

  it('a renderer-forged consent (boolean semantics, wrong digest, grown capabilities) never lands', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    const candidate = harness.read().sources[0].candidates[0];
    expect(candidate.compatible).toBe(true);

    const booleanForgery = await harness.service.installExtension('src-1', 'sample-review', true as unknown as ConsentParam);
    expect(booleanForgery.ok).toBe(false);
    if (!booleanForgery.ok) {
      expect(booleanForgery.error).toContain('Consent');
    }

    const digestForgery = await harness.service.installExtension('src-1', 'sample-review', {
      digest: createHash('sha256').update('not-what-was-consented').digest('hex'),
      capabilities: candidate.consent.capabilities,
      version: candidate.consent.version,
    } as ConsentParam);
    expect(digestForgery.ok).toBe(false);
    if (!digestForgery.ok) {
      expect(digestForgery.error).toContain('digest');
    }

    const capabilityForgery = await harness.service.installExtension('src-1', 'sample-review', {
      digest: candidate.digest,
      capabilities: [...candidate.consent.capabilities, 'propose'],
      version: candidate.consent.version,
    } as ConsentParam);
    expect(capabilityForgery.ok).toBe(false);

    expect(harness.read().packs).toHaveLength(0);
    expect(harness.read().sourceInstalls).toHaveLength(0);

    const honest = await harness.service.installExtension('src-1', 'sample-review', {
      digest: candidate.consent.digest,
      capabilities: candidate.consent.capabilities,
      version: candidate.consent.version,
    } as ConsentParam);
    expect(honest.ok, honest.ok ? '' : honest.error).toBe(true);
    const record = harness.read().sourceInstalls[0].consents[0];
    expect(record.digest).toBe(candidate.digest);
    expect([...record.capabilities].sort()).toEqual([...candidate.consent.capabilities].sort());
    expect(record.at).toBe(1_700_000_000_000);
  });

  it('update re-consent is verified against the re-derived content — a forged echo is refused', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    await harness.service.syncSource('src-1');
    const first = harness.read().sources[0].candidates[0];
    await harness.service.installExtension('src-1', 'sample-review', {
      digest: first.consent.digest,
      capabilities: first.consent.capabilities,
      version: first.consent.version,
    } as ConsentParam);

    harness.transport.stage('v1.1.0', await writeTree(join(scratch, 'grown'), envelopeFixture((envelope) => {
      (envelope.capabilities as string[]).push('propose');
      Object.assign(envelope, { version: '0.2.0' });
    })));
    await harness.service.syncSource('src-1');
    const update = harness.read().sourceInstalls[0].update;
    expect(update?.state).toBe('available');
    if (update?.state !== 'available') {
      return;
    }
    expect(update.requiresReconsent).toBe(true);

    const forged = await harness.service.applyUpdate('src-1', 'sample-review', { digest: '0'.repeat(64), capabilities: [], version: '0.0.0' } as ConsentParam);
    expect(forged.ok).toBe(false);

    const auto = await harness.service.applyUpdate('src-1', 'sample-review', null as unknown as ConsentParam);
    expect(auto.ok).toBe(false);
    if (!auto.ok) {
      expect(auto.error).toContain('re-consent');
    }

    const next = harness.read().sources[0].candidates[0];
    const honest = await harness.service.applyUpdate('src-1', 'sample-review', {
      digest: next.consent.digest,
      capabilities: next.consent.capabilities,
      version: next.consent.version,
    } as ConsentParam);
    expect(honest.ok, honest.ok ? '' : honest.error).toBe(true);
    const record = harness.read().sourceInstalls[0].consents.at(-1);
    expect(record.reconsent).toBe(true);
    expect(record.digest).toBe(next.digest);
    expect(record.capabilities).toContain('propose');
  });
});

// ------------------- local sources: production gate + root confinement (H4/H5)

describe('local sources are production-gated AND confined to allowlisted roots', () => {
  type ConsentParam = Parameters<typeof ExtensionSourcesService.prototype.installExtension>[2];

  async function localDir(...segments: string[]): Promise<string> {
    const dir = join(scratch, ...segments);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it('production refuses local sources at every seam; git sources stay available', async () => {
    let production = false;
    const harness = createHarness({ localSourcesAllowed: () => !production });
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));

    const git = await harness.service.addSource({ url: 'https://git.example.com/ext/repo', ref: { strategy: 'release-tag' } });
    expect(git.ok).toBe(true);

    const devLocal = await harness.service.addSource({
      local: { path: await localDir('repos', 'ext') },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(devLocal.ok).toBe(true);

    production = true;

    const refused = await harness.service.addSource({
      local: { path: await localDir('other', 'ext') },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('production');
    }

    const syncRefused = await harness.service.syncSource(devLocal.ok ? devLocal.source.id : 'src-2');
    expect(syncRefused.ok).toBe(false);
    if (!syncRefused.ok) {
      expect(syncRefused.error.detail).toContain('production');
    }

    const installRefused = await harness.service.installExtension(
      devLocal.ok ? devLocal.source.id : 'src-2',
      'sample-review',
      { digest: 'a'.repeat(64), capabilities: [], version: '1.0.0' } as ConsentParam
    );
    expect(installRefused.ok).toBe(false);
    if (!installRefused.ok) {
      expect(installRefused.error).toContain('production');
    }

    await harness.service.syncSource('src-1');
    const candidate = harness.read().sources[0].candidates[0];
    const gitInstall = await harness.service.installExtension('src-1', 'sample-review', {
      digest: candidate.consent.digest,
      capabilities: candidate.consent.capabilities,
      version: candidate.consent.version,
    } as ConsentParam);
    expect(gitInstall.ok, gitInstall.ok ? '' : gitInstall.error).toBe(true);
  });

  it('fails closed when no allowlisted root is configured (even in dev)', async () => {
    const harness = createHarness({ localSourceRoots: () => [] });
    const refused = await harness.service.addSource({
      local: { path: await localDir('repos', 'ext') },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('allowlisted root');
    }
  });

  it('refuses a local path outside every allowlisted root and accepts one inside', async () => {
    const allowed = await localDir('allowed');
    const outside = await localDir('outside');
    const harness = createHarness({ localSourceRoots: () => [allowed] });

    const refused = await harness.service.addSource({
      local: { path: outside },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('outside every allowlisted root');
    }
    expect(harness.read().sources ?? []).toHaveLength(0);

    const acceptedPath = join(allowed, 'ext');
    await mkdir(acceptedPath);
    const accepted = await harness.service.addSource({
      local: { path: acceptedPath },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(accepted.ok, accepted.ok ? '' : accepted.error).toBe(true);
  });

  it('resolves symlinks before comparing — a link inside a root cannot escape it', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const allowed = await localDir('allowed');
    const outside = await localDir('outside');
    const escape = join(allowed, 'escape');
    await symlink(outside, escape, 'dir');
    const harness = createHarness({ localSourceRoots: () => [allowed] });

    const refused = await harness.service.addSource({
      local: { path: escape },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('outside every allowlisted root');
    }
  });

  it('is path-segment aware — a prefix sibling is not inside the root', async () => {
    const allowed = await localDir('allowed');
    const sibling = await localDir('allowed-evil');
    const harness = createHarness({ localSourceRoots: () => [allowed] });
    const refused = await harness.service.addSource({
      local: { path: sibling },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('outside every allowlisted root');
    }
  });

  it('reports a missing path under a root as not-found (never a half-add)', async () => {
    const allowed = await localDir('allowed');
    const harness = createHarness({ localSourceRoots: () => [allowed] });
    const refused = await harness.service.addSource({
      local: { path: join(allowed, 'missing') },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toContain('does not exist');
    }
    expect(harness.read().sources ?? []).toHaveLength(0);
  });

  it('dev mode still allows local sources end to end (root configured)', async () => {
    const harness = createHarness();
    harness.transport.stage('v1.0.0', await writeTree(scratch, envelopeFixture()));
    const added = await harness.service.addSource({
      local: { path: await localDir('repos', 'ext') },
      ref: { strategy: 'branch', value: 'main' },
    });
    expect(added.ok, added.ok ? '' : added.error).toBe(true);
    const synced = await harness.service.syncSource('src-1');
    expect(synced.ok, JSON.stringify(synced)).toBe(true);
    const candidate = harness.read().sources[0].candidates[0];
    const installed = await harness.service.installExtension('src-1', 'sample-review', {
      digest: candidate.consent.digest,
      capabilities: candidate.consent.capabilities,
      version: candidate.consent.version,
    } as ConsentParam);
    expect(installed.ok, installed.ok ? '' : installed.error).toBe(true);
    expect(harness.read().sourceInstalls[0].extensionId).toBe('sample-review');
  });
});

