import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_SCHEMA } from '@shared/app-pack/manifest.schema.generated';
import { checkManifestSchema } from '@shared/app-pack/schemaCheck';
import { BUNDLED_CODE_PACKS } from '@packs';
import { MiniAppRegistry } from '@main/apps/registry';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import { createHash } from 'node:crypto';

const REFERENCE_PACK: unknown = JSON.parse(readFileSync(join(process.cwd(), 'src/packs/file-deletion-review/pack.json'), 'utf8'));

const SCHEMA_ID = 'https://neuronection.dev/contracts/mini-app-packs.manifest.schema.json';

function validator(): ReturnType<Ajv2020['compile']> {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  return ajv.compile(MANIFEST_SCHEMA as unknown as Record<string, unknown>);
}

describe('manifest JSON Schema export (plan 30 S1)', () => {
  it('every bundled manifest validates against the emitted schema (imported + bundled variants)', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema(MANIFEST_SCHEMA as unknown as Record<string, unknown>);
    const imported = ajv.compile({ $ref: SCHEMA_ID });
    const bundled = ajv.compile({ $ref: `${SCHEMA_ID}#/$defs/bundledManifest` });

    expect(imported(REFERENCE_PACK)).toBe(true);
    expect(imported.errors ?? []).toEqual([]);
    for (const manifest of BUNDLED_CODE_PACKS) {
      const ok = bundled((manifest as { manifest?: unknown }).manifest ?? manifest);
      expect(ok, (manifest as { id?: string }).id ?? 'pack').toBe(true);
      expect(bundled.errors ?? []).toEqual([]);
    }
  });

  it('a deliberately broken manifest fails with schema-pointed paths', () => {
    const validate = validator();
    const broken = {
      ...(REFERENCE_PACK as Record<string, unknown>),
      id: 'BAD_ID',
      apiVersion: 9,
      capabilities: ['net', 'ui'],
    };
    const ok = validate(broken);
    expect(ok).toBe(false);
    const paths = (validate.errors ?? []).map((error) => error.instancePath);
    expect(paths).toContain('/id');
    expect(paths).toContain('/apiVersion');
    expect(paths).toContain('/capabilities/0');
  });

  it('the structural pre-check accepts the reference pack and rejects broken shapes with paths', () => {
    expect(checkManifestSchema(REFERENCE_PACK)).toEqual({ ok: true });
    const result = checkManifestSchema({ ...(REFERENCE_PACK as Record<string, unknown>), version: 'not-semver', report: { nodes: [{ id: 'x', type: 'gauge' }] } });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const messages = result.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
    expect(messages).toContain('$.version');
    expect(messages).toContain('$.report');
  });
});

describe('import path schema pre-check (plan 30 S2)', () => {
  let tempDir = '';

  beforeEach(() => {
    const base = join(process.cwd(), 'node_modules', '.tmp');
    tempDir = mkdtempSync(join(base, 'pack-schema-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createRegistry(): { registry: MiniAppRegistry; read: () => AppConfig['miniApps'] } {
    let config: AppConfig = { ...structuredClone(DEFAULT_CONFIG), miniApps: { masterEnabled: true, packs: [] } };
    const registry = new MiniAppRegistry({
      config: () => config,
      updateMiniApps: async (patch) => {
        config = { ...config, miniApps: { ...config.miniApps, ...patch } };
      },
      now: () => Date.now(),
      sha256: (input) => createHash('sha256').update(input).digest('hex'),
    });
    return { registry, read: () => config.miniApps };
  }

  it('a structurally invalid import rejects with the schema gate and schema-pointed paths', async () => {
    const { registry } = createRegistry();
    const broken = {
      ...(REFERENCE_PACK as Record<string, unknown>),
      capabilities: ['definitely-not-a-capability'],
      id: 'BAD_ID',
    };
    const result = await registry.importManifest(JSON.stringify(broken), { kind: 'imported' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('structurally invalid (schema)');
      expect(result.error).toContain('$.capabilities[0]');
      expect(result.error).toContain('$.id');
      expect(result.error).toContain('the full validator remains normative');
    }
  });

  it('a schema-clean import that the full validator rejects reports validator issues (schema is not "valid")', async () => {
    const { registry } = createRegistry();
    const stripped = structuredClone(REFERENCE_PACK) as { i18n: { locales: Record<string, Record<string, string>> } } & Record<string, unknown>;
    for (const locale of Object.values(stripped.i18n.locales)) {
      delete locale.title;
    }
    const result = await registry.importManifest(JSON.stringify(stripped), { kind: 'imported' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('structurally invalid (schema)');
      expect(result.error.toLowerCase()).toContain('title');
    }
  });

  it('a valid import is unchanged (full validator still normative)', async () => {
    const { registry, read } = createRegistry();
    const result = await registry.importManifest(JSON.stringify(REFERENCE_PACK), { kind: 'imported' });
    expect(result.ok).toBe(true);
    expect(read().packs).toHaveLength(1);
    expect(read().packs[0].origin.kind).toBe('imported');
  });
});
