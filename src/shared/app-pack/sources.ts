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

/** What a consent surface MUST show before an imported install (D7/D19). */
export interface ConsentPayload {
  extensionId: string;
  version: string;
  subpath: string;
  digest: string;
  tier: 'T0';
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
