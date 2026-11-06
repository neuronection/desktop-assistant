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

function createRegistry(
  initialPacks: AppConfig['miniApps']['packs'] = [],
  status?: { record: (input: { appId: string; kind: 'pack'; status: 'ok' | 'degraded' | 'failing' | 'stale'; error?: string | null }) => Promise<void> }
) {
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
    t2Isolation: () => 'kernel',
    ...(status ? { status } : {}),
  };
  return { registry: new MiniAppRegistry(deps), read: () => config.miniApps, updates };
}

describe('MiniAppRegistry — install lifecycle', () => {
  it('records pack status for install and sandbox self-disable (plan 38 S1)', async () => {
    const calls: Array<{ appId: string; status: string; error?: string | null }> = [];
    const { registry } = createRegistry([], {
      record: async (input) => {
        calls.push(input);
      },
    });
    const result = await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported', path: '/tmp/sample.json' });
    expect(result.ok).toBe(true);
    const id = (sample as { id: string }).id;
    expect(calls.at(-1)).toMatchObject({ appId: id, status: 'ok' });
    await registry.selfDisable(id, 'sandbox died');
    expect(calls.at(-1)).toMatchObject({ appId: id, status: 'failing', error: 'sandbox died' });
  });

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

describe('MiniAppRegistry — self-disable (the ToolAppService boot pattern)', () => {
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
  it('saves validated config and rejects out-of-schema values', async () => {    const { registry } = createRegistry();
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

describe('plan 51 S2 — rule-binding introspection', () => {
  function rulesPackVariant(): Record<string, unknown> {
    return variant((pack) => {
      const classify = (pack.run as Record<string, unknown>).classify as Record<string, unknown[]>;
      classify.keep = [
        { id: 'user-keep', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.keepRules' } },
        ...classify.keep,
      ];
      classify.ask = [{ id: 'user-review', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.reviewRules' } }];
      classify.candidate = [
        ...classify.candidate,
        { id: 'user-junk', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.junkRules' } },
        { id: 'not-glob', when: { signal: 'meta.path', op: 'matches-any', value: ['fixed/**'] } },
      ];
      const schema = pack.configSchema as Record<string, unknown>;
      schema.properties = {
        ...(schema.properties as Record<string, unknown>),
        keepRules: { type: 'array', items: { type: 'string' }, default: [] },
        reviewRules: { type: 'array', items: { type: 'string' }, default: [] },
        junkRules: { type: 'array', items: { type: 'string' }, default: [] },
      };
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      i18n.locales.en['rule.user-keep'] = 'On your keep list';
      i18n.locales.en['rule.user-review'] = 'On your review list';
      i18n.locales.en['rule.user-junk'] = 'On your junk list';
      i18n.locales.en['rule.not-glob'] = 'Fixed list';
      i18n.locales.en['config.keepRules'] = 'Keep rules';
      i18n.locales.en['config.reviewRules'] = 'Review rules';
      i18n.locales.en['config.junkRules'] = 'Junk rules';
    });
  }

  it('resolves config-bound matches-any rules with labels; skips fixed lists and non-array keys', async () => {
    const { registry } = createRegistry();
    const result = await registry.importProjectedManifest(JSON.stringify(rulesPackVariant()), { kind: 'imported' });
    expect(result.ok).toBe(true);
    const bindings = registry.bindingsFor('sample-review');
    expect(bindings.map((binding) => [binding.ruleId, binding.list, binding.configKey])).toEqual([
      ['exceptions', 'veto', 'exceptions'],
      ['user-keep', 'keep', 'keepRules'],
      ['user-review', 'ask', 'reviewRules'],
      ['user-junk', 'candidate', 'junkRules'],
    ]);
    expect(bindings.map((binding) => binding.label)).toEqual([
      'On the exception list',
      'On your keep list',
      'On your review list',
      'On your junk list',
    ]);
    const view = registry.getState().packs.find((pack) => pack.id === 'sample-review');
    expect(view?.ruleBindings).toEqual(bindings);
    expect(view?.classifyRules).toMatchObject({ veto: [{ id: 'exceptions' }] });
  });

  it('returns no bindings for a pack without bound rules beyond the sample veto', async () => {
    const { registry } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    expect(registry.bindingsFor('sample-review')).toEqual([
      { ruleId: 'exceptions', list: 'veto', configKey: 'exceptions', label: 'On the exception list' },
    ]);
    expect(registry.bindingsFor('ghost')).toEqual([]);
    const view = registry.getState().packs.find((pack) => pack.id === 'sample-review');
    expect(view?.ruleBindings).toEqual(registry.bindingsFor('sample-review'));
  });
});

describe('plan 53 S2 — launch-option introspection', () => {
  function launchPackVariant(): Record<string, unknown> {
    return variant((pack) => {
      pack.launch = {
        options: [
          {
            id: 'mode-pick',
            labelKey: 'launch.mode',
            type: 'select',
            configKey: 'mode',
            choices: [{ value: 'a', labelKey: 'launch.mode.a' }, { value: 'b' }],
          },
          { id: 'dry', labelKey: 'launch.dry', type: 'switch', configKey: 'dryRun' },
          { id: 'root', labelKey: 'launch.root', type: 'path', required: true },
          { id: 'unlabeled', type: 'text' },
        ],
      };
      const i18n = pack.i18n as Record<string, Record<string, string>>;
      i18n.locales.en['launch.mode'] = 'Mode';
      i18n.locales.en['launch.mode.a'] = 'Mode A';
      i18n.locales.en['launch.dry'] = 'Dry run';
      i18n.locales.en['launch.root'] = 'Folder';
      i18n.locales.en['config.freshDays.description'] = 'Files modified within this many days are kept without review.';
    });
  }

  it('projects launch options with labels and choice labels resolved, ids as fallback', async () => {
    const { registry } = createRegistry();
    const result = await registry.importProjectedManifest(JSON.stringify(launchPackVariant()), { kind: 'imported' });
    expect(result.ok).toBe(true);
    const fields = registry.getState().packs.find((pack) => pack.id === 'sample-review')?.configFields ?? [];
    expect(fields.find((field) => field.name === 'freshDays')?.description).toBe('Files modified within this many days are kept without review.');
    const view = registry.getState().packs.find((pack) => pack.id === 'sample-review');
    expect(view?.launchOptions).toEqual([
      { id: 'mode-pick', label: 'Mode', type: 'select', configKey: 'mode', choices: [{ value: 'a', label: 'Mode A' }, { value: 'b', label: 'b' }] },
      { id: 'dry', label: 'Dry run', type: 'switch', configKey: 'dryRun' },
      { id: 'root', label: 'Folder', type: 'path', required: true },
      { id: 'unlabeled', label: 'unlabeled', type: 'text' },
    ]);
  });

  it('leaves launchOptions absent for a pack that declares none', async () => {
    const { registry } = createRegistry();
    await registry.importProjectedManifest(JSON.stringify(sample), { kind: 'imported' });
    const view = registry.getState().packs.find((pack) => pack.id === 'sample-review');
    expect(view?.launchOptions).toBeUndefined();
  });
});
