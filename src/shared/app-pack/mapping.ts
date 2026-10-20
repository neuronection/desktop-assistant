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

export type EnvelopeTier = 'T0' | 'T2';

const DESKTOP_PROFILE = (
  EXTENSION_CHARTER.hostProfiles.profiles as readonly {
    product: string;
    honors?: readonly string[];
    honorsByTier?: Readonly<Record<string, readonly string[]>>;
    surfaces?: readonly string[] | string;
  }[]
).find((profile) => profile.product === 'desktop-assistant');

export const HOSTED_KINDS = ['mini-app'] as const;

export const HONORED_CAPABILITIES: readonly string[] =
  DESKTOP_PROFILE?.honorsByTier?.T0 ?? DESKTOP_PROFILE?.honors ?? [];

export function honoredCapabilitiesForTier(tier: EnvelopeTier): readonly string[] {
  return DESKTOP_PROFILE?.honorsByTier?.[tier] ?? DESKTOP_PROFILE?.honors ?? [];
}

const DEGRADE_RULES = EXTENSION_CHARTER.surfaces.degradeRules as Record<string, readonly string[]>;

/** The charter's T0 disclosure, VERBATIM (D22 — paraphrasing is a conformance failure). */
export const T0_DECLARATIVE_DISCLOSURE: string = EXTENSION_CHARTER.consent.t0DeclarativeDisclosure;

/** The charter's T2 sandbox disclosure, VERBATIM (D22 — paraphrasing is a conformance failure). */
export const T2_SANDBOX_DISCLOSURE: string = EXTENSION_CHARTER.consent.t2SandboxDisclosure;

const ENVELOPE_ONLY_FIELDS = new Set([
  'kind',
  'packKind',
  'description',
  'domains',
  'tools',
  'itemSchema',
  'supportsIncremental',
  'kindVersion',
  'surfaces',
  'data',
]);

/**
 * Projects a schema-valid imported family envelope onto a desktop pack
 * manifest. Both tiers project through this one reader: the registry,
 * renderer, consent payload and `manifestDiff` all speak the pack shape.
 * The envelope-shared metadata (author, license, repository, categories,
 * docs) passes THROUGH; the remaining envelope-only fields (kind axis,
 * connector refinements, per-surface schemas, data blocks) have no
 * pack-manifest home and are dropped here — the caller reads them from
 * the envelope it passed in.
 *
 * Tier is provenance, not manifest data: `entry` is required for T2 and
 * forbidden for T0. `contributions` and `entry` pass through; `code` is
 * rejected outright (deleted in 7A-1).
 */
export function projectImportedEnvelope(
  envelope: Record<string, unknown>,
  tier: EnvelopeTier = 'T0',
  options: { checkProfile?: boolean } = {},
): ProjectionResult {
  const kind = envelope.kind;
  if (kind !== 'mini-app') {
    return {
      ok: false,
      reason: `kind ${JSON.stringify(kind)} is not hosted for import (desktop hosts the mini-app kind; bridge is server-class)`,
    };
  }
  if ('code' in envelope) {
    return {
      ok: false,
      reason: "field 'code' is deleted — imported code is declared as the root 'entry' path (never inline code)",
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
  const entry = envelope.entry;
  if (tier === 'T2') {
    if (typeof entry !== 'string' || entry.length === 0) {
      return { ok: false, reason: "Tier 2 requires a root 'entry' path (the imported code entry)" };
    }
  } else if (entry !== undefined) {
    return { ok: false, reason: "Tier 0 is declarative — an 'entry' declares code and is not allowed" };
  }

  const capabilities = Array.isArray(envelope.capabilities) ? envelope.capabilities : [];
  const honored = honoredCapabilitiesForTier(tier);
  for (const capability of capabilities) {
    if (capability === 'net') {
      return { ok: false, reason: "capability 'net' is the exfiltration class — the desktop sandbox denies it (ADR-0029 clause 6 / ADR-0030)" };
    }
    if (options.checkProfile !== false && !honored.includes(capability as string)) {
      return {
        ok: false,
        reason: `capability '${String(capability)}' is not honored by this host at ${tier} (desktop honors: ${honored.join(', ')}) — self-disable`,
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
