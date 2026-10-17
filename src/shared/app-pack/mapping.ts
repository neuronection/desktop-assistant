/**
 * The family-envelope → desktop pack-manifest projection (plan 32
 * Phase 8, ADR-0040 D8/D13/D17/D25). Pure TypeScript — the one explicit,
 * tested mapping that makes the FAMILY envelope importable on desktop.
 *
 * The compat check is DATA (the charter's law): the honored capability
 * set, the hosted surfaces and the degrade chains all read from the
 * vendored `extension-charter.json` desktop-assistant host profile —
 * never from code branches. Anything the host cannot honor self-disables
 * with a reason (never half-installs); `net` is the exfiltration-class
 * rejection at T0; pre-charter artifacts are re-authored, never converted.
 */

import { EXTENSION_CHARTER } from './extension.generated';
import { PACK_API_VERSION } from './contract.generated';

export interface EnvelopeProjection {
  ok: true;
  manifest: Record<string, unknown>;
}

export interface EnvelopeRejection {
  ok: false;
  reason: string;
}

export type ProjectionResult = EnvelopeProjection | EnvelopeRejection;

const DESKTOP_PROFILE = (
  EXTENSION_CHARTER.hostProfiles.profiles as readonly { product: string; honors?: string[]; surfaces?: string[] | string }[]
).find((profile) => profile.product === 'desktop-assistant');

export const HOSTED_KINDS = ['mini-app'] as const;

export const HONORED_CAPABILITIES: readonly string[] = DESKTOP_PROFILE?.honors ?? [];

const DEGRADE_RULES = EXTENSION_CHARTER.surfaces.degradeRules as Record<string, readonly string[]>;

/** The charter's T0 disclosure, VERBATIM (D22 — paraphrasing is a conformance failure). */
export const T0_DECLARATIVE_DISCLOSURE: string = EXTENSION_CHARTER.consent.t0DeclarativeDisclosure;

/** The charter's T2 sandbox disclosure, VERBATIM (D22 — paraphrasing is a conformance failure). */
export const T2_SANDBOX_DISCLOSURE: string = EXTENSION_CHARTER.consent.t2SandboxDisclosure;

const ENVELOPE_ONLY_FIELDS = new Set([
  'kind',
  'packKind',
  'author',
  'license',
  'repository',
  'categories',
  'description',
  'domains',
  'tools',
  'secrets',
  'itemSchema',
  'supportsIncremental',
  'kindVersion',
  'surfaces',
  'data',
]);

/**
 * Projects a schema-valid family envelope onto a desktop pack manifest.
 * The envelope fields with no pack-manifest home (provenance, categories)
 * are carried on the source install record instead — the caller reads
 * them from the envelope it passed in.
 */
export function projectEnvelope(envelope: Record<string, unknown>): ProjectionResult {
  const kind = envelope.kind;
  if (kind !== 'mini-app') {
    return {
      ok: false,
      reason: `kind ${JSON.stringify(kind)} is not hosted for import (desktop hosts the mini-app kind; bridge is server-class)`,
    };
  }
  const apiVersion = envelope.apiVersion;
  if (typeof apiVersion !== 'number' || !Number.isInteger(apiVersion)) {
    return { ok: false, reason: `apiVersion must be the mini-app integer lineage (got ${JSON.stringify(apiVersion)})` };
  }
  if (apiVersion > PACK_API_VERSION) {
    return {
      ok: false,
      reason: `apiVersion ${apiVersion} is too new — requires host apiVersion >= ${apiVersion} (host has ${PACK_API_VERSION}); self-disable`,
    };
  }
  const packKind = envelope.packKind;
  if (packKind !== 'assessment' && packKind !== 'surface') {
    return { ok: false, reason: `packKind must be assessment or surface (got ${JSON.stringify(packKind)})` };
  }

  const capabilities = Array.isArray(envelope.capabilities) ? envelope.capabilities : [];
  for (const capability of capabilities) {
    if (capability === 'net') {
      return { ok: false, reason: "capability 'net' is the exfiltration class — Tier 0 never grants it (ADR-0029 clause 6)" };
    }
    if (!HONORED_CAPABILITIES.includes(capability as string)) {
      return {
        ok: false,
        reason: `capability '${String(capability)}' is not honored by this host (desktop honors: ${HONORED_CAPABILITIES.join(', ')}) — self-disable`,
      };
    }
  }

  const surfaces = envelope.surfaces;
  if (surfaces !== undefined) {
    if (surfaces === null || typeof surfaces !== 'object' || Array.isArray(surfaces)) {
      return { ok: false, reason: 'surfaces must be an object of per-surface schemas' };
    }
    const declared = Object.keys(surfaces);
    const chains = declared.map((surface) => `${surface}→${[...(DEGRADE_RULES[surface] ?? [])].join('→') || '(end)'}`);
    return {
      ok: false,
      reason: `per-surface declarative schemas (surfaces.${declared.join(', ')}; degrade ${chains.join(', ')}) have no desktop rendering host — the window surface renders the pack report schema; self-disable rather than render a different surface`,
    };
  }
  if (envelope.data !== undefined) {
    return {
      ok: false,
      reason: "declarative data blocks ('data') have no desktop rendering host — self-disable",
    };
  }

  const configSchemaProblem = checkConfigSchemaPortability(envelope.configSchema);
  if (configSchemaProblem !== null) {
    return { ok: false, reason: configSchemaProblem };
  }

  const manifest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (!ENVELOPE_ONLY_FIELDS.has(key)) {
      manifest[key] = value;
    }
  }
  manifest.kind = packKind;
  const withDescription = injectDescription(manifest, envelope.description);
  return { ok: true, manifest: withDescription };
}

/**
 * D15/D19 re-author-never-convert: config shapes the mini-app kind
 * refinement cannot express (a `required` list, `x-secret` fields) reject
 * with a precise reason — desktop's pack-config store is plain validated
 * config, never a secret store.
 */
function checkConfigSchemaPortability(configSchema: unknown): string | null {
  if (configSchema === undefined || configSchema === null) {
    return null;
  }
  if (typeof configSchema !== 'object' || Array.isArray(configSchema)) {
    return 'configSchema must be an object';
  }
  const schema = configSchema as Record<string, unknown>;
  if (schema.required !== undefined) {
    return 'configSchema.required is not expressible in the mini-app kind refinement — re-author the pack with defaults (never converted, D15)';
  }
  const properties = schema.properties;
  if (properties !== undefined && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) {
    return 'configSchema.properties must be an object';
  }
  if (properties) {
    for (const [name, field] of Object.entries(properties)) {
      if (typeof field === 'object' && field !== null && (field as Record<string, unknown>)['x-secret'] !== undefined) {
        return `config field '${name}' declares x-secret — the desktop pack-config store is not a secret store (D19); self-disable`;
      }
    }
  }
  return null;
}

/** The envelope top-level description rides the pack i18n `description` key. */
function injectDescription(manifest: Record<string, unknown>, description: unknown): Record<string, unknown> {
  if (typeof description !== 'string' || description.length === 0) {
    return manifest;
  }
  const i18n = manifest.i18n;
  if (typeof i18n !== 'object' || i18n === null) {
    return manifest;
  }
  const locales = (i18n as Record<string, unknown>).locales;
  if (typeof locales !== 'object' || locales === null) {
    return manifest;
  }
  const patched: Record<string, Record<string, unknown>> = {};
  for (const [locale, map] of Object.entries(locales as Record<string, unknown>)) {
    const entries = typeof map === 'object' && map !== null ? (map as Record<string, unknown>) : {};
    patched[locale] = 'description' in entries ? entries : { description, ...entries };
  }
  return { ...manifest, i18n: { ...(i18n as Record<string, unknown>), locales: patched } };
}
