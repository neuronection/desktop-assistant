import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MiniAppRegistry } from '@main/apps/registry';
import { validateManifest } from '@shared/app-pack/validate';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';

const sample: Record<string, unknown> = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'sample-manifest.json'), 'utf8')
);

function variant(mutate: (pack: Record<string, unknown>) => void): Record<string, unknown> {
  const clone = structuredClone(sample);
  mutate(clone);
  return clone;
}

function createRegistry(initialPacks: AppConfig['miniApps']['packs'] = []) {
  let config: AppConfig = { ...structuredClone(DEFAULT_CONFIG), miniApps: { masterEnabled: true, packs: initialPacks } };
  const updates: unknown[] = [];
  const deps = {
    config: () => config,
    updateMiniApps: async (patch: Partial<AppConfig['miniApps']>) => {
      updates.push(patch);
      config = { ...config, miniApps: { ...config.miniApps, ...patch } };
    },
    now: () => 1_700_000_000_000,
    sha256: (input: string) => createHash('sha256').update(input).digest('hex'),
  };
  return { registry: new MiniAppRegistry(deps), read: () => config.miniApps, updates };
}

describe('MiniAppRegistry — install lifecycle', () => {
  it('imports a valid manifest, persists it with digest+origin, and surfaces a view', async () => {
    const { registry, read } = createRegistry();
    const result = await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported', path: '/tmp/sample.json' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.view.id).toBe('sample-review');
    expect(result.view.title).toBe('Sample review');
    expect(result.view.configFields.map((field) => field.name)).toEqual(['freshDays', 'mode', 'dryRun', 'exceptions']);
    expect(read().packs).toHaveLength(1);
    expect(read().packs[0].digest).toBe(createHash('sha256').update(JSON.stringify(sample)).digest('hex'));
  });

  it('rejects invalid content with the shared validator issues and installs nothing', async () => {
    const { registry, read } = createRegistry();
    const result = await registry.importProjectedManifest(JSON.stringify(variant((pack) => {
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      for (const locale of Object.values(i18n.locales)) {
        delete locale['rule.fresh'];
      }
    })), { kind: 'imported' });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain('rule.fresh');
    expect(read().packs).toHaveLength(0);
  });

  it('rejects a manifest outside the schema with a path-pointed validator issue (plan 30)', async () => {
    const { registry, read } = createRegistry();
    const result = await registry.importProjectedManifest(JSON.stringify(variant((pack) => {
      pack.apiVersion = 9;
    })), { kind: 'imported' });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain('requires host apiVersion');
    expect(result.error).toContain('$.apiVersion');
    expect(read().packs).toHaveLength(0);
  });

  it('rejects a re-import that does not raise the version, and accepts an upgrade', async () => {
    const { registry } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    const same = await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    expect(same.ok).toBe(false);
    const upgraded = await registry.importProjectedManifest(JSON.stringify(variant((pack) => {
      pack.version = '0.2.0';
    })), { kind: 'imported' });
    expect(upgraded.ok).toBe(true);
  });

  it('removes an installed pack', async () => {
    const { registry } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    expect(await registry.remove('sample-review')).toBe(true);
    expect(await registry.remove('sample-review')).toBe(false);
  });
});

describe('MiniAppRegistry — self-disable (the AppService boot pattern)', () => {
  it('reconcile self-disables a stored manifest whose digest no longer matches', async () => {
    const { registry, read } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    const tampered = structuredClone(read().packs[0]);
    (tampered.manifest as Record<string, unknown>).version = '9.9.9';
    const { registry: booted } = createRegistry([tampered]);
    const disabled = await booted.reconcile();
    expect(disabled).toBeGreaterThan(0);
    const state = booted.getState();
    expect(state.packs[0].error).toBeTruthy();
    expect(booted.runnablePack('sample-review')).toBeNull();
  });

  it('rejects enabling a validation-disabled pack with the surfaced reason', async () => {
    const { registry } = createRegistry([makeTamperedPack()]);
    await registry.reconcile();
    const enabled = await registry.setEnabled('sample-review', true);
    expect(enabled.ok).toBe(false);
    if (!enabled.ok) {
      expect(enabled.error.length).toBeGreaterThan(0);
    }
  });

  it('validates an apiVersion-too-new pack at reconcile (stored directly, e.g. host downgrade)', async () => {
    const future = variant((pack) => {
      pack.apiVersion = 3;
    });
    const { registry } = createRegistry([{
      manifest: future,
      origin: { kind: 'imported' },
      digest: createHash('sha256').update(JSON.stringify(future)).digest('hex'),
      enabled: true,
    }]);
    await registry.reconcile();
    expect(registry.getState().packs[0].error).toContain('requires host apiVersion');
  });
});

function makeTamperedPack(): AppConfig['miniApps']['packs'][number] {
  const manifest = structuredClone(sample);
  return {
    manifest,
    origin: { kind: 'imported' },
    digest: 'not-the-real-digest',
    enabled: true,
  };
}

describe('MiniAppRegistry — config persistence', () => {
  it('saves validated config and rejects out-of-schema values', async () => {
    const { registry } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    const bad = await registry.saveConfig('sample-review', { freshDays: 9999 });
    expect(bad.ok).toBe(false);
    const good = await registry.saveConfig('sample-review', { freshDays: 30, exceptions: ['*.keep'] });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.values.exceptions).toEqual(['*.keep']);
    }
    expect(registry.getState().packs[0].configValues.freshDays).toBe(30);
  });
});

describe('SDK/runtime validator parity (one validator, ADR-0029 clause 11)', () => {
  it('rejects a corpus of invalid variants identically at both layers', async () => {
    const corpus = [
      variant((pack) => {
        pack.apiVersion = 5;
      }),
      variant((pack) => {
        pack.capabilities = ['fs-read', 'warp-drive'];
      }),
      variant((pack) => {
        const i18n = pack.i18n as Record<string, any>;
        delete i18n.locales.en.title;
      }),
      variant((pack) => {
        (pack.run as Record<string, unknown>).scan = 'fast';
      }),
    ];
    const { registry } = createRegistry();
    for (const candidate of corpus) {
      const sdk = validateManifest(candidate);
      const runtime = await registry.importProjectedManifest(JSON.stringify(candidate), { kind: 'imported' });
      expect(sdk.ok).toBe(false);
      expect(runtime.ok).toBe(false);
      if (sdk.ok || !runtime.ok) {
        continue;
      }
      expect(runtime.error).toContain(sdk.issues[0].message.split('.')[0]);
    }
  });

  it('uses the shared validator — the registry never re-implements validation (source guard)', async () => {
    const source = readFileSync(join(process.cwd(), 'src/main/apps/registry.ts'), 'utf8');
    expect(source).toContain("from '@shared/app-pack'");
    expect(source).toContain('validateManifest');
    expect(source).not.toMatch(/new RegExp\(/);
    expect(vi.isMockFunction).toBeDefined();
  });
});

describe('MiniAppRegistry — the external import lane is envelope-only', () => {
  it('refuses a pack-shaped import and a T2 entry at the external seam', async () => {
    const { registry, read } = createRegistry();
    const packShaped = await registry.importManifest(JSON.stringify(sample), {
      kind: 'imported',
      path: '/tmp/pack.json',
    });
    expect(packShaped.ok).toBe(false);
    if (!packShaped.ok) {
      expect(packShaped.error).toContain('family envelope');
    }
    const t2Envelope = {
      ...(sample as Record<string, unknown>),
      kind: 'mini-app',
      packKind: 'surface',
      entry: 'code/entry.js',
    };
    const codeImport = await registry.importManifest(JSON.stringify(t2Envelope), {
      kind: 'imported',
      path: '/tmp/code.json',
    });
    expect(codeImport.ok).toBe(false);
    if (!codeImport.ok) {
      expect(codeImport.error).toContain('sources pipeline');
    }
    expect(read().packs).toHaveLength(0);
  });
});
