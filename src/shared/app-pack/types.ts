/**
 * Mini-app pack SDK types (plan 26 S1, ADR-0029). Pure TypeScript —
 * no Electron, no Node APIs, no network. Vocabularies derive from
 * `contract.generated.ts` (single source: contracts/mini-app-packs.json);
 * the runtime and the SDK share ONE validator (`validate.ts`).
 */

import type { DecisionQuestion } from '../ai/decisions';
import type { MiniAppSourceRecord, SourceInstallRecord } from './sources';
import type {
  PACK_CAPABILITIES,
  PACK_SLOTS,
  PACK_KINDS,
  PACK_VERDICTS,
  PACK_QUESTION_TYPES,
  PACK_RUN_STATUSES,
  PACK_RUN_EVENTS,
  PACK_ITEM_STATES,
  PACK_REPORT_COMPONENTS,
  PACK_RUN_ACTIONS,
  PACK_ITEM_ACTIONS,
  PACK_ERROR_CODES,
  PACK_LEAF_OPS,
  PACK_PROPOSE_VERBS,
  PACK_EXPORT_FORMATS,
} from './contract.generated';

export type PackCapability = (typeof PACK_CAPABILITIES)[number];
export type PackSlotId = (typeof PACK_SLOTS)[number];
export type PackKind = (typeof PACK_KINDS)[number];
export type PackVerdict = (typeof PACK_VERDICTS)[number];
export type PackQuestionType = (typeof PACK_QUESTION_TYPES)[number];
export type PackRunStatus = (typeof PACK_RUN_STATUSES)[number];
export type PackRunEvent = (typeof PACK_RUN_EVENTS)[number];
export type PackItemState = (typeof PACK_ITEM_STATES)[number];
export type PackReportComponentType = (typeof PACK_REPORT_COMPONENTS)[number];
export type PackRunActionId = (typeof PACK_RUN_ACTIONS)[number];
export type PackItemActionId = (typeof PACK_ITEM_ACTIONS)[number];
export type PackErrorCode = (typeof PACK_ERROR_CODES)[number];
export type PackLeafOp = (typeof PACK_LEAF_OPS)[number];
export type PackProposeVerb = (typeof PACK_PROPOSE_VERBS)[number];
export type PackExportFormat = (typeof PACK_EXPORT_FORMATS)[number];

/** Ordered classify rule lists; `veto`/`keep` both land on `keep` (plan 26). */
export type PackRuleListId = 'veto' | 'keep' | 'ask' | 'candidate';

export type PackValidationCode =
  | 'api-version'
  | 'identity'
  | 'capability'
  | 'kind'
  | 'pipeline'
  | 'i18n'
  | 'privacy'
  | 'report'
  | 'liveCard'
  | 'config-schema'
  | 'limits'
  | 'cross-reference'
  | 'reserved'
  | 'malformed';

export interface PackValidationIssue {
  /** Path into the manifest, e.g. `run.classify.keep[0].when.signal`. */
  path: string;
  code: PackValidationCode;
  message: string;
}

export type PackValidationResult = { ok: true; pack: ValidatedPack } | { ok: false; issues: PackValidationIssue[] };

/** The canonical JSON Schema subset packs may use for config/runParams. */
export type PackConfigField =
  | {
      type: 'string';
      enum?: string[];
      default?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
      title?: string;
      description?: string;
    }
  | {
      type: 'number';
      default?: number;
      minimum?: number;
      maximum?: number;
      title?: string;
      description?: string;
    }
  | {
      type: 'boolean';
      default?: boolean;
      title?: string;
      description?: string;
    }
  | {
      type: 'array';
      items: { type: 'string'; enum?: string[] };
      default?: string[];
      minItems?: number;
      maxItems?: number;
      title?: string;
      description?: string;
    };

export interface PackConfigSchema {
  type: 'object';
  properties: Record<string, PackConfigField>;
  additionalProperties?: false;
}

export interface PackPrivacy {
  sendsContent: boolean;
  sensitiveGlobs: string[];
  contentCapBytes?: number;
}

/** Declarative condition AST (compose + classify predicates). */
export type PackCondition =
  | { all: PackCondition[] }
  | { any: PackCondition[] }
  | { not: PackCondition }
  | { signal: string; op: PackLeafOp; value?: string | number | boolean; valueSignal?: string };

export interface PackClassifyRule {
  id: string;
  when: PackCondition;
  /** Extra locale-free evidence data (never rendered as a label). */
  note?: string;
}

export interface PackScanStep {
  includeHidden?: boolean;
  excludeGlobs?: string[];
  fileCap?: number;
  maxDepth?: number;
}

export interface PackClassifyStep {
  veto?: PackClassifyRule[];
  keep?: PackClassifyRule[];
  ask?: PackClassifyRule[];
  candidate?: PackClassifyRule[];
}

export interface PackDecideStep {
  questions: DecisionQuestion[];
  /** Content excerpts may ride questions only with privacy.sendsContent. */
  readContext?: boolean;
  /** Optional per-run gate over config signals (S7) — excerpt read iff readContext AND this passes. */
  readContextWhen?: PackCondition;
}

export interface PackComposeStep {
  keepWhen?: PackCondition;
  candidateWhen?: PackCondition;
  askWhen?: PackCondition;
}

export interface PackProposeStep {
  verb: PackProposeVerb;
  /** Signal path grouping proposals by category (e.g. `answer.category.choice`). */
  groupBy?: string;
  /** Fail-closed gate: minimum answer confidence to arm (exceptions and sensitive globs are host-enforced always). */
  gate: { minConfidence: number };
}

/** The run pipeline (assessment packs only). Order is fixed by the contract. */
export interface PackPipeline {
  scan: PackScanStep;
  classify: PackClassifyStep;
  decide?: PackDecideStep;
  compose: PackComposeStep;
  propose?: PackProposeStep;
}

export type PackReportNode =
  | { id: string; type: 'stat'; bind: string }
  | { id: string; type: 'table'; columns: string[] }
  | { id: string; type: 'cards'; of: 'items' | 'groups' }
  | { id: string; type: 'filter-bar'; filters: string[] }
  | { id: string; type: 'select'; bind: string; options: string[] }
  | { id: string; type: 'badge'; bind: string }
  | { id: string; type: 'progress'; bind: string }
  | { id: string; type: 'actions'; actions: (PackRunActionId | PackItemActionId)[] }
  | { id: string; type: 'evidence' };

export interface PackReportSchema {
  nodes: PackReportNode[];
}

/** Live run-card subset (plan 28 S1) — validated against PACK_LIVE_CARD_BINDS. */
export type PackLiveCardNode =
  | { id: string; type: 'badge'; bind: string }
  | { id: string; type: 'stat'; bind: string }
  | { id: string; type: 'progress'; bind: string };

export interface PackLiveCardSchema {
  nodes: PackLiveCardNode[];
}

export interface PackI18n {
  defaultLocale: string;
  locales: Record<string, Record<string, string>>;
}

export interface PackManifestBase {
  apiVersion: number;
  id: string;
  version: string;
  kind: PackKind;
  /** Envelope-shared provenance (D25) — rendered verbatim by display/consent surfaces. */
  author?: string;
  /** Envelope-shared provenance — SPDX identifier preferred (e.g. MIT, Apache-2.0). */
  license?: string;
  /** Envelope-shared provenance — https-only git URL (the family distribution surface). */
  repository?: string;
  /** Envelope-shared closed browse vocabulary (charter categories, mirrored into the pack contract). */
  categories?: string[];
  /** Per-extension documentation pointer (plan 34 §10.3) — the one fixed value `docs/docs-tree.json`. */
  docs?: string;
  capabilities: PackCapability[];
  configSchema?: PackConfigSchema;
  defaults?: Record<string, unknown>;
  runParams?: PackConfigSchema;
  privacy?: PackPrivacy;
  report?: PackReportSchema;
  /** Live run-card node customization (plan 28); absent → the SDK DEFAULT_LIVE_CARD. */
  liveCard?: PackLiveCardSchema;
  i18n: PackI18n;
  /** Inline raster-only data-URL (png/jpeg/webp); monogram fallback otherwise. */
  icon?: string;
  /** Slot contributions (code packs: Tier 1 bundled, Tier 2 sandboxed; shallow-validated ids in v1). */
  contributions?: Partial<Record<PackSlotId, { id: string; labelKey?: string }[]>>;
  /** Code entry (Tier 1 bundled; Tier 2 imported — sandboxed, ADR-0030). */
  code?: { entry: string };
  /** Secret slot declarations (Tier 2 imported code packs; values live in the keyring, never config). */
  secrets?: { id: string }[];
}

export interface AssessmentPackManifest extends PackManifestBase {
  kind: 'assessment';
  run: PackPipeline;
  privacy: PackPrivacy;
}

export interface SurfacePackManifest extends PackManifestBase {
  kind: 'surface';
}

export type PackManifest = AssessmentPackManifest | SurfacePackManifest;

/** The validated, normalized pack the host may run. */
export interface ValidatedPack {
  manifest: PackManifest;
  /** i18n keys the structure requires (all locales carry the same set). */
  requiredI18nKeys: string[];
  configKeys: string[];
}

/**
 * The closed error-detail vocabulary (plan 37 7E / D3 — bounded object;
 * `capability-rpc.schema.json` $defs.errorDetail, mirrored by
 * `contract.cap_error_detail`): declared keys only, `message` is the one
 * capped diagnostic slot (logs/typed machine surfaces) — product copy is
 * keyed by `code` and may interpolate the data keys, never `message` raw.
 */
export type ErrorDetail = {
  message?: string;
  path?: string;
  field?: string;
  id?: string;
  packId?: string;
  runId?: string;
  slot?: string;
  host?: string;
  hop?: number;
  method?: string;
  op?: string;
  stage?: string;
  engine?: string;
  expected?: string;
  actual?: string;
  limit?: number;
  used?: number;
};

/** Typed capability error (contract `errors`): codes are closed, detail is data. */
export interface PackError {
  code: PackErrorCode;
  detail?: ErrorDetail;
  retryable?: 'yes' | 'no' | 'after-delay' | 'after-config-change';
}

/** What persists in `config.miniApps` (plan 26 D11 — toolApps parity). */
export interface InstalledMiniApp {
  manifest: unknown;
  origin: { kind: 'bundled' | 'imported'; path?: string; importedAt?: number };
  digest: string;
  enabled: boolean;
  /** Self-disable reason (boot revalidation or import failure state). */
  error?: string;
  config?: Record<string, unknown>;
}

export interface MiniAppsSettings {
  masterEnabled: boolean;
  packs: InstalledMiniApp[];
  /** Removed bundled pack ids — ensureBundled never resurrects them (restore clears the tombstone). */
  removedBundled: string[];
  /** Extension sources (plan 32 Phase 8) — validated descriptors + sync state. */
  sources?: MiniAppSourceRecord[];
  /** Imported-install sidecars: consent history, pins, park state, updates. */
  sourceInstalls?: SourceInstallRecord[];
  /** Tier-2 sandbox policy knobs (ADR-0030) — defaults in DEFAULT_SANDBOX_LIMITS. */
  sandbox?: Partial<import('./sandbox').SandboxLimits>;
}

/** Flattened config field for the settings auto-form (renderer never parses schemas). */
export interface MiniAppConfigFieldView {
  name: string;
  /** Resolved from the pack's default-locale i18n (`config.<name>`); the raw name is the fallback. */
  label?: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  enum?: string[];
  default?: string | number | boolean | string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
}

/** Wire shape for the settings surface — the manifest itself never crosses raw. */
export interface MiniAppView {
  id: string;
  version: string;
  kind: PackKind;
  title: string;
  description?: string;
  icon?: string;
  /** Envelope-shared provenance (D25) — rendered verbatim on cards. */
  author?: string;
  license?: string;
  repository?: string;
  /** Envelope-shared closed browse vocabulary (charter categories). */
  categories?: string[];
  capabilities: string[];
  enabled: boolean;
  error?: string;
  originKind: 'bundled' | 'imported';
  importedAt?: number;
  /** Tier-2 sandboxed code pack (ADR-0030) — provenance-derived, never manifest-claimed. */
  sandboxed?: boolean;
  /** Per-extension docs (plan 34 wave 8) — the manifest carries the docs
   * pointer; the main process validates + serves the tree (renderer
   * untrusted: presence flag only, never a path). */
  docs?: boolean;  /** Command ids the pack's `commands` contribution declares (surface packs). */
  commands: string[];
  configFields: MiniAppConfigFieldView[];
  configValues: Record<string, unknown>;
}

export interface MiniAppsState {
  masterEnabled: boolean;
  packs: MiniAppView[];
  /** Bundled pack ids that were removed (restore affordance, plan 26). */
  removedBundled: string[];
}

export type ImportMiniAppResult =
  | { ok: true; view: MiniAppView }
  | { ok: false; error: string };

export type MiniAppSetEnabledResult = { ok: true } | { ok: false; error: string };

export type MiniAppSaveConfigResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

export interface MiniAppRunTotalsView {
  scanned: number;
  keep: number;
  ask: number;
  candidate: number;
  ruleDecided: number;
  modelDecided: number;
  cacheHits: number;
  pending: number;
}

export interface MiniAppRunView {
  id: string;
  packId: string;
  packVersion: string;
  rootPath: string;
  status: PackRunStatus;
  totals: MiniAppRunTotalsView | null;
  estimateCalls: number;
  actualCalls: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  conversationId: string | null;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface MiniAppRunItemView {
  relPath: string;
  verdict: PackVerdict;
  confidence: number | null;
  decidedBy: string;
  evidence: Record<string, unknown> | null;
}

export interface MiniAppRunReportView {
  run: MiniAppRunView;
  packTitle: string;
  items: MiniAppRunItemView[];
  /** Pre-installed surfaces */
  reportNodes: unknown[];
  /** Pack labels (default locale) for report components, rules and config keys. */
  labels: Record<string, string>;
  /** Items beyond the display cap were dropped (export for the full set). */
  itemsTruncated?: number;
  /** True when the pack declares arming (propose + fs-write-quarantine). */
  canArm: boolean;
  /** True when the pack declares `ui:window` (host window surfaces, ADR-0040 clause 16). */
  windowSupported: boolean;
}

export type MiniAppExportFormat = 'markdown' | 'json' | 'csv';

/**
 * The declarative surface view (ADR-0040 clause 16 / D23): the
 * denormalized transport every renderer of the family fixture contract
 * consumes — nodes from the closed component vocabulary, rows, dot-path
 * bind values and group headings. Hosts map their own surfaces (run
 * reports, declared pages) onto this shape; parity is asserted by
 * `contracts/surface-renderer.fixtures.json`, never per wire byte.
 */
export interface PackSurfaceNode {
  id: string;
  type: PackReportComponentType;
  /** Data key for stat/badge/progress/select — dot-walked into `values`. */
  bind?: string;
  /** table column keys. */
  columns?: string[];
  /** cards grouping mode. */
  of?: 'items' | 'groups';
  /** filter-bar facet ids (option defs live on the host-provided `filters`). */
  filters?: string[];
  /** select option values. */
  options?: string[];
  /** Typed action ids (closed vocabulary; unknown ids never render). */
  actions?: string[];
}

export interface PackSurfaceRow {
  /** Stable row id — the `surface-row-<id>` walk key. */
  id: string;
  /** Table cells / card bindings, keyed by column name. */
  values: Record<string, unknown>;
  /** Card heading (resolved host-side). */
  title?: string;
  /** Short status chip text. */
  badge?: string;
  /** Which column the badge chip replaces in tables. */
  badgeField?: string;
  /** cards.of='groups' grouping key (headings via `groups` or status.* labels). */
  group?: string;
  /** Muted per-card detail segments. */
  meta?: string[];
  /** Structured evidence payload (renders the mandatory drilldown). */
  evidence?: unknown;
  /** One-line evidence summary, resolved host-side. */
  evidenceSummary?: string;
  /** Typed row actions (only closed ids render). */
  actions?: string[];
}

export interface PackSurfaceFilterOption {
  value: string;
  /** Resolved option label (raw value when absent). */
  label?: string;
}

export interface PackSurfaceFilter {
  /** The filter-bar facet id the node names. */
  id: string;
  options: PackSurfaceFilterOption[];
}

export interface PackSurfaceAction {
  id: PackRunActionId | PackItemActionId;
  /** The row the action targets, when row-level. */
  rowId?: string;
}

export interface PackSurfaceView {
  nodes: PackSurfaceNode[];
  rows?: PackSurfaceRow[];
  /** Bind targets for stat/badge/progress — dot paths into this object. */
  values?: Record<string, unknown>;
  /** cards.of='groups' group key → resolved heading. */
  groups?: Record<string, string>;
}

/** `miniapps:window-open` result — `focused` when the per-pack cap redirected the open. */
export type MiniAppWindowOpenResult = { ok: true; opened: boolean } | { ok: false; error: string };

export interface MiniAppRunDiffEntry {
  relPath: string;
  kind: 'new' | 'removed' | 'changed' | 'verdict-change';
  before?: string;
  after?: string;
}

export interface MiniAppRunDiffView {
  runId: string;
  baselineRunId: string | null;
  entries: MiniAppRunDiffEntry[];
}

/** User override on an item — readable by later runs of the same pack+root (S5). */
export interface MiniAppFeedbackView {
  packId: string;
  rootPath: string;
  relPath: string;
  verdict: PackVerdict;
  source: 'override' | 'exclude';
  note?: string;
}

/** Push payload for the `miniapps:run-event` broadcast (S4 — renderer renders, never orchestrates). */
export interface MiniAppRunEventPayload {
  type: string;
  runId: string;
  packId: string;
  status?: string;
  estimateCalls?: number;
  phase?: string;
  done?: number;
  total?: number;
  /** run:items batch size (coalesced item decisions since the last flush). */
  count?: number;
  relPath?: string;
  verdict?: string;
  decidedBy?: string;
}

/** Message-metadata payload for the per-run history card (S4, schedules precedent). */
export interface MiniAppRunMessageMetadata {
  runId: string;
  packId: string;
  packTitle: string;
  status: PackRunStatus;
  rootPath: string;
  totals?: MiniAppRunTotalsView;
  estimateCalls?: number;
  actualCalls?: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

/** Host-resolved live-card spec for a pack (plan 28 S2): manifest `liveCard` nodes or the SDK default, with `live.<id>` i18n labels. */
export interface MiniAppLiveCardView {
  packId: string;
  nodes: PackLiveCardNode[];
  labels: Record<string, string>;
}

/** Per-pack run aggregates for the Usage dashboard (plan 29) — main-side reduce, read-only. */
export interface MiniAppRunStatsRow {
  packId: string;
  packTitle: string;
  runs: number;
  itemsScanned: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** cacheHits / modelDecided — null when the pack never decided by model in the window. */
  cacheHitRatio: number | null;
  paused: number;
  canceled: number;
  failed: number;
  lastRunAt: number | null;
}

export interface MiniAppRunStats {
  windowDays: number | null;
  rows: MiniAppRunStatsRow[];
}

/** Pack docs wire types (plan 34 wave 8): the main process validates the
 * tree and serves only tree-listed pages — the renderer names a pack id
 * and a file string, nothing more. */
export type PackDocsResult =
  | { ok: true; tree: Record<string, unknown>; landing: string }
  | { ok: false; error: string };

export type PackDocPageResult = { ok: true; markdown: string } | { ok: false; error: string };
