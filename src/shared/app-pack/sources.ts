/**
 * Extension sources + consent + updates (plan 32 Phase 8, ADR-0040
 * D13/D15/D19/D22/D25): the wire shapes for the sources pipeline, the
 * consent surface and the origin-class display law. Persisted records
 * live in `config.miniApps.sources`; the installed pack itself keeps
 * living in the registry store (`packs[]`) — the source install record
 * is the provenance/consent/pin sidecar keyed by the pack id.
 */

export type ExtensionOriginClass = 'bundled' | 'imported' | 'listed';

export type SourceKind = 'git' | 'local';

export type SourceStatus = 'ok' | 'degraded' | 'failing' | 'stale';

/**
 * What a consent surface MUST show before an imported install (D7/D19).
 */
export interface ConsentPayload {
  extensionId: string;
  version: string;
  subpath: string;
  digest: string;
  tier: 'T0' | 'T2';
  importClass: 'imported';
  originClass: ExtensionOriginClass;
  capabilities: string[];
  provenance: {
    author?: string;
    license?: string;
    repository?: string;
    description?: string;
  };
  /** The vendored charter disclosure, rendered VERBATIM (D22). */
  disclosure: string;
}

/**
 * The main-verified consent echo (H4): the digest + capability set the
 * consent surface DISPLAYED. The renderer may only restate what main
 * computed at sync time — main re-derives both from the refetched
 * content at install/update time and refuses on mismatch. Echo values
 * are never written into a consent record; the record binds the
 * main-derived digest, capability set and timestamp only.
 */
export interface ConsentEcho {
  digest: string;
  capabilities: string[];
}

const CONSENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function isConsentEcho(value: unknown): value is ConsentEcho {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.digest !== 'string' || !CONSENT_DIGEST_PATTERN.test(record.digest)) {
    return false;
  }
  if (!Array.isArray(record.capabilities) || record.capabilities.length > 64) {
    return false;
  }
  return record.capabilities.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 64);
}

/** Set equality of the echo against the main-derived consent payload (fail-closed on any difference). */
export function consentEchoMatches(echo: ConsentEcho, actual: ConsentPayload): boolean {
  if (echo.digest !== actual.digest) {
    return false;
  }
  const actualSet = new Set(actual.capabilities);
  if (echo.capabilities.length !== actualSet.size) {
    return false;
  }
  return echo.capabilities.every((capability) => actualSet.has(capability));
}

export interface SourceRefHistoryEntry {
  ref: string;
  digest: string;
  at: number;
}

export interface ConsentRecord extends ConsentPayload {
  at: number;
  /** The acting confirmation — desktop is single-user (D7 consent record law). */
  actor: 'user';
  reconsent?: boolean;
}

export interface ManifestDiff {
  versionFrom: string;
  versionTo: string;
  capabilitiesAdded: string[];
  configSchemaChanged: boolean;
}

export type UpdateState =
  | {
      state: 'available';
      ref: string;
      digest: string;
      manifestDiff: ManifestDiff;
      /** D15/D22: capability growth or configSchema change re-consents. */
      requiresReconsent: boolean;
    }
  | {
      state: 'digest-drift';
      ref: string;
      expectedDigest: string;
      foundDigest: string;
      detail: string;
    }
  | { state: 'absent-from-source' };

/** One discovered, validated candidate offered by a source (D25 'listed'). */
export interface SourceCandidate {
  extensionId: string;
  subpath: string;
  digest: string;
  ref: string;
  compatible: boolean;
  /** The host-profile incompatibility reason when `compatible` is false. */
  reason?: string;
  consent: ConsentPayload;
  /** The projected pack form's configSchema — the byte-identical-manifest test field (D22). */
  configSchema?: unknown;
}

/** Persisted per-source record — `config.miniApps.sources[]`. */
export interface MiniAppSourceRecord {
  id: string;
  kind: SourceKind;
  origin: string;
  /** The validated descriptor verbatim (slot references only — no values). */
  descriptor: Record<string, unknown>;
  status: SourceStatus;
  error?: string;
  lastCheckedAt?: number;
  lastSuccessAt?: number;
  consecutiveFailures: number;
  candidates: SourceCandidate[];
}

/** The imported-install sidecar (consent history, pin, park, updates). */
export interface SourceInstallRecord {
  extensionId: string;
  sourceId: string;
  subpath: string;
  version: string;
  digest: string;
  pinRef: string;
  refHistory: SourceRefHistoryEntry[];
  consents: ConsentRecord[];
  provenance: ConsentPayload['provenance'];
  /** Content-addressed store dir: <userData>/mini-apps/<id>/<digest>. */
  contentPath: string;
  /** The landed content tree digest (Tier-2 code packs) — the spawn pin the child re-derives. */
  contentDigest?: string;
  /** Park-on-removal (D22): disabled + flagged, data intact, tombstone-able. */
  parked?: { reason: string; at: number };
  update?: UpdateState;
}

export type AddSourceResult =
  | { ok: true; source: MiniAppSourceRecord }
  | { ok: false; error: string };

export type SourceSyncResult =
  | {
      ok: true;
      resolvedRef: string | null;
      candidates: SourceCandidate[];
      updates: { extensionId: string; state: 'current' | UpdateState['state'] }[];
    }
  | { ok: false; error: { code: string; detail: string } };

export type InstallExtensionResult =
  | { ok: true; extensionId: string; view: MiniAppSourceInstallView }
  | { ok: false; error: string };

export type ApplyUpdateResult = InstallExtensionResult;

/** Renderer view of one source (candidates carry consent payloads). */
export interface MiniAppSourceView {
  id: string;
  kind: SourceKind;
  origin: string;
  status: SourceStatus;
  error?: string;
  lastCheckedAt?: number;
  lastSuccessAt?: number;
  consecutiveFailures: number;
  candidates: SourceCandidate[];
  ref: { strategy: string; value?: string } | null;
  subpath: string;
  installs: MiniAppSourceInstallView[];
}

/** Installed-from-source view (origin chip 'imported', pin + update state). */
export interface MiniAppSourceInstallView {
  extensionId: string;
  sourceId: string;
  version: string;
  digest: string;
  pinRef: string;
  parked: boolean;
  parkedReason?: string;
  originClass: ExtensionOriginClass;
  provenance: ConsentPayload['provenance'];
  consentedAt: number | null;
  update: UpdateState | null;
  enabled: boolean;
  error?: string;
}

export interface MiniAppSourcesState {
  sources: MiniAppSourceView[];
  installs: MiniAppSourceInstallView[];
}

export type RestoreExtensionResult =
  | { ok: true; extensionId: string }
  | { ok: false; error: string };
