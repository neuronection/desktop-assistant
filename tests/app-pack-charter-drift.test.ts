import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACK_CAPABILITIES,
  PACK_ERROR_CODES,
  PACK_KINDS,
  PACK_REPORT_COMPONENTS,
  PACK_SLOTS,
  ENVELOPE_SCHEMA,
  SOURCES_SCHEMA,
  EXTENSION_CHARTER,
  SANDBOX_CAPABILITIES,
} from '@shared/app-pack';
import { checkSchema } from '@shared/app-pack/schemaCheck';
import { manifestI18nSemantics } from '@shared/app-pack/registration';

const FIXTURES = JSON.parse(readFileSync(join('contracts', 'extension-contract.fixtures.json'), 'utf8')) as {
  manifest: {
    valid: { name: string; doc: unknown }[];
    invalid: { name: string; doc: unknown; reject?: 'schema' | 'semantics' }[];
  };
  bundled: {
    valid: { name: string; doc: unknown }[];
    invalid: { name: string; doc: unknown; reject?: 'schema' | 'semantics' }[];
  };
  sources: { valid: { name: string; doc: unknown; against?: string }[]; invalid: { name: string; doc: unknown; against?: string }[] };
};

const charterCaps = new Set(EXTENSION_CHARTER.capabilities.map((capability) => capability.id));
const charterComponents = new Set(EXTENSION_CHARTER.components.vocabulary);
const charterErrors = new Set(EXTENSION_CHARTER.errors.codes.map((error) => error.code));
const charterSurfaces = new Set(EXTENSION_CHARTER.surfaces.taxonomy);

describe('charter-superset drift wall (plan 32 Phase 8): the generated pack vocabularies stay a subset of the vendored charter', () => {
  it('every pack capability exists in the charter capability taxonomy (via the miniAppMapping table)', () => {
    const mapping = EXTENSION_CHARTER.miniAppMapping.capabilities as unknown as Record<string, string | string[]>;
    const targets = (id: string): string[] => {
      const mapped = mapping[id] ?? id;
      return Array.isArray(mapped) ? mapped : [mapped];
    };
    for (const capability of PACK_CAPABILITIES) {
      for (const target of targets(capability)) {
        expect(charterCaps.has(target), `capability '${capability}' maps to '${target}' which is missing from the vendored charter`).toBe(true);
      }
    }
  });

  it('every pack error code maps into the charter error enum', () => {
    for (const code of PACK_ERROR_CODES) {
      expect(charterErrors.has(code), `error code '${code}' is missing from the vendored charter`).toBe(true);
    }
  });

  it('the report component vocabulary is the charter component vocabulary seed (verbatim)', () => {
    expect([...PACK_REPORT_COMPONENTS].sort()).toEqual([...charterComponents].sort());
  });

  it('every pack slot maps onto a charter surface (miniAppMapping.slots)', () => {
    const slotMap = EXTENSION_CHARTER.miniAppMapping.slots as unknown as Record<string, string>;
    for (const slot of PACK_SLOTS) {
      const target = slotMap[slot];
      expect(typeof target, `slot '${slot}' has no charter surface mapping`).toBe('string');
      expect(charterSurfaces.has(target), `mapping target '${target}' is not a charter surface`).toBe(true);
    }
  });

  it('pack kinds carry the charter packKind refinement (miniAppMapping.kinds)', () => {
    for (const kind of PACK_KINDS) {
      expect(EXTENSION_CHARTER.miniAppMapping.kinds).toHaveProperty(kind);
    }
  });
});

describe('cross-language fixture wall (D23): the vendored fixtures accept/reject through the desktop interpreter', () => {
  it('accepts every valid imported-manifest fixture against the vendored envelope schema', () => {
    for (const fixture of FIXTURES.manifest.valid) {
      const verdict = checkSchema(ENVELOPE_SCHEMA, fixture.doc);
      expect(verdict.ok, `${fixture.name}: ${verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`).toBe(true);
      expect(manifestI18nSemantics(fixture.doc), `${fixture.name}: i18n semantics`).toEqual([]);
    }
  });

  it('rejects every invalid imported-manifest fixture (typed, path-pointed)', () => {
    for (const fixture of FIXTURES.manifest.invalid) {
      const verdict = checkSchema(ENVELOPE_SCHEMA, fixture.doc);
      if (fixture.reject === 'semantics') {
        expect(verdict.ok, `${fixture.name}: semantics channel but the schema rejected it`).toBe(true);
        expect(manifestI18nSemantics(fixture.doc).length, `${fixture.name} must be rejected by the semantic channel`).toBeGreaterThan(0);
      } else {
        expect(verdict.ok, `${fixture.name} must be rejected`).toBe(false);
      }
    }
  });

  it('accepts every valid bundled-manifest fixture against $defs.bundledManifest', () => {
    const bundled = (ENVELOPE_SCHEMA as { $defs: { bundledManifest: unknown } }).$defs.bundledManifest;
    for (const fixture of FIXTURES.bundled.valid) {
      const verdict = checkSchema(bundled, fixture.doc, ENVELOPE_SCHEMA);
      expect(verdict.ok, `${fixture.name}: ${verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`).toBe(true);
      expect(manifestI18nSemantics(fixture.doc), `${fixture.name}: i18n semantics`).toEqual([]);
    }
  });

  it('rejects every invalid bundled-manifest fixture', () => {
    const bundled = (ENVELOPE_SCHEMA as { $defs: { bundledManifest: unknown } }).$defs.bundledManifest;
    for (const fixture of FIXTURES.bundled.invalid) {
      const verdict = checkSchema(bundled, fixture.doc, ENVELOPE_SCHEMA);
      if (fixture.reject === 'semantics') {
        expect(verdict.ok, `${fixture.name}: semantics channel but the schema rejected it`).toBe(true);
        expect(manifestI18nSemantics(fixture.doc).length, `${fixture.name} must be rejected by the semantic channel`).toBeGreaterThan(0);
      } else {
        expect(verdict.ok, `${fixture.name} must be rejected`).toBe(false);
      }
    }
  });

  it('accepts every valid source-descriptor fixture (root, local, desired-state variants)', () => {
    const defs = (SOURCES_SCHEMA as { $defs: Record<string, unknown> }).$defs;
    for (const fixture of FIXTURES.sources.valid) {
      const target = fixture.against?.includes('desiredState')
        ? defs.desiredStateDocument
        : fixture.against?.includes('localSource')
          ? defs.localSourceDescriptor
          : SOURCES_SCHEMA;
      const verdict = checkSchema(target, fixture.doc);
      expect(verdict.ok, `${fixture.name}: ${verdict.ok ? '' : verdict.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`).toBe(true);
    }
  });

  it('rejects every invalid source-descriptor fixture incl. inline tokens and traversal', () => {
    const defs = (SOURCES_SCHEMA as { $defs: Record<string, unknown> }).$defs;
    for (const fixture of FIXTURES.sources.invalid) {
      const target = fixture.against?.includes('desiredState')
        ? defs.desiredStateDocument
        : fixture.against?.includes('localSource')
          ? defs.localSourceDescriptor
          : SOURCES_SCHEMA;
      const verdict = checkSchema(target, fixture.doc);
      expect(verdict.ok, `${fixture.name} must be rejected`).toBe(false);
    }
  });

  it('the local variant never validates against the production root (structural separation)', () => {
    const local = FIXTURES.sources.valid.find((fixture) => fixture.name === 'local-source-descriptor');
    expect(local).toBeDefined();
    expect(checkSchema(SOURCES_SCHEMA, local.doc).ok).toBe(false);
  });
});

describe('sandbox capability drift wall (plan 32 S1–S2 / ADR-0030): the sandbox grant set is charter-derived', () => {
  const charterById = new Map(EXTENSION_CHARTER.capabilities.map((capability) => [capability.id, capability]));

  it('every sandbox capability has tier 2 in the vendored charter', () => {
    expect(SANDBOX_CAPABILITIES.length).toBeGreaterThan(0);
    for (const id of SANDBOX_CAPABILITIES) {
      const capability = charterById.get(id);
      expect(capability, `${id} must exist in the vendored charter`).toBeDefined();
      expect(capability?.tiers ?? [], `${id} must carry tier 2 in the charter`).toContain(2);
    }
  });

  it('net is charter-T2 but denied for desktop code packs (ADR-0030 clauses 4/6) — the exclusion is deliberate', () => {
    const net = charterById.get('net');
    expect(net?.tiers).toContain(2);
    expect(SANDBOX_CAPABILITIES).not.toContain('net');
  });

  it('the charter T2 vocabulary minus the desktop-unhonored set equals the sandbox set', () => {
    const t2 = [...charterById.entries()].filter(([, capability]) => (capability.tiers as number[]).includes(2)).map(([id]) => id);
    const desktopUnhonored = ['net', 'ui:panel', 'ui:page', 'ui:window', 'chat-tools'];
    expect([...SANDBOX_CAPABILITIES].sort()).toEqual(t2.filter((id) => !desktopUnhonored.includes(id)).sort());
  });
});
