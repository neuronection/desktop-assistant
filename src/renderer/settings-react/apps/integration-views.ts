import {
  EXTENSION_CAPABILITIES,
  EXTENSION_CATEGORIES,
  EXTENSION_REF_STRATEGIES,
  type ExtensionCategory,
  type IntegrationCapabilityView,
  type IntegrationConfigFieldView,
  type IntegrationConfigValues,
  type IntegrationConsentChangeView,
  type IntegrationConsentPayloadView,
  type IntegrationDiscoveredView,
  type IntegrationExtensionGroupView,
  type IntegrationExtensionView,
  type IntegrationInstanceView,
  type IntegrationProvenanceView,
  type IntegrationSourceDraft,
  type IntegrationSourceRowView,
  type ExtensionRefStrategy,
} from '@neuronection/assistant-ui/integration-contracts';
import type {
  ConsentPayload,
  MiniAppSourceInstallView,
  MiniAppSourceView,
  MiniAppSourcesState,
  MiniAppView,
  SourceCandidate,
  UpdateState,
} from '@shared/app-pack';

export function capabilityViews(ids: string[]): IntegrationCapabilityView[] {
  return ids.map((id) =>
    (EXTENSION_CAPABILITIES as readonly string[]).includes(id)
      ? { id: id as IntegrationCapabilityView['id'], riskClass: null }
      : ({ id, riskClass: null } as IntegrationCapabilityView)
  );
}

function packCategories(categories: string[] | undefined): ExtensionCategory[] {
  if (!categories || categories.length === 0) {
    return [];
  }
  return categories.filter((category): category is ExtensionCategory =>
    (EXTENSION_CATEGORIES as readonly string[]).includes(category)
  );
}

/** Manifest provenance — rendered verbatim (D25 law); absent fields stay absent. */
function packProvenance(view: MiniAppView): IntegrationProvenanceView | null {
  if (!view.author && !view.license && !view.repository) {
    return null;
  }
  return {
    ...(view.author ? { author: view.author } : {}),
    ...(view.license ? { license: view.license } : {}),
    ...(view.repository ? { repository: view.repository } : {}),
    description: view.description ?? null,
  };
}

export function packCardView(view: MiniAppView): IntegrationExtensionView {
  return {
    id: view.id,
    name: view.title,
    version: view.version,
    summary: view.description ?? null,
    originClass: view.originKind === 'bundled' ? 'bundled' : 'imported',
    tier: 'T0',
    kind: 'mini-app',
    ...(packCategories(view.categories).length > 0 ? { categories: packCategories(view.categories) } : {}),
    capabilities: capabilityViews(view.capabilities),
    provenance: packProvenance(view),
    update: null,
  };
}
export function packConfigFields(view: MiniAppView): IntegrationConfigFieldView[] {
  return view.configFields.map((field) => ({
    name: field.name,
    type: field.type,
    title: field.label ?? null,
    description: null,
    enum: field.enum ?? null,
    defaultValue: field.default ?? null,
    minimum: field.minimum ?? null,
    maximum: field.maximum ?? null,
    minLength: null,
    maxLength: null,
    pattern: field.pattern ?? null,
    minItems: field.minItems ?? null,
    maxItems: field.maxItems ?? null,
    itemType: null,
    secret: false,
    required: false,
  }));
}

function configValue(value: unknown): IntegrationConfigValues[string] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return [...value];
  }
  return null;
}

export function packConfigValues(view: MiniAppView): IntegrationConfigValues {
  const values: IntegrationConfigValues = {};
  for (const field of view.configFields) {
    values[field.name] = configValue(view.configValues[field.name] ?? field.default);
  }
  return values;
}

export function toConfigWire(values: IntegrationConfigValues): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) {
      wire[name] = value;
    }
  }
  return wire;
}

export function sourceRefStrategy(strategy: string): ExtensionRefStrategy | null {
  return (EXTENSION_REF_STRATEGIES as readonly string[]).includes(strategy)
    ? (strategy as ExtensionRefStrategy)
    : null;
}

function isoTime(ms: number | undefined | null): string | null {
  return ms === undefined || ms === null ? null : new Date(ms).toISOString();
}

function updateView(update: UpdateState | null): IntegrationUpdateViewOf | null {
  if (!update) {
    return null;
  }
  if (update.state === 'available') {
    return {
      state: 'available',
      version: update.manifestDiff.versionTo,
      ref: update.ref,
      digest: update.digest,
      requiresReconsent: update.requiresReconsent,
      detail: null,
    };
  }
  if (update.state === 'digest-drift') {
    return {
      state: 'digest-drift',
      ref: update.ref,
      digest: update.foundDigest,
      requiresReconsent: undefined,
      detail: update.detail,
    };
  }
  return null;
}

type IntegrationUpdateViewOf = NonNullable<IntegrationExtensionView['update']>;

export function consentView(
  payload: ConsentPayload,
  variant: IntegrationConsentPayloadView['variant'] = 'install',
  changeSummary: IntegrationConsentChangeView | null = null
): IntegrationConsentPayloadView {
  return {
    variant,
    extensionId: payload.extensionId,
    version: payload.version,
    tier: payload.tier,
    importClass: payload.importClass,
    capabilities: capabilityViews(payload.capabilities),
    provenance: payload.provenance,
    digest: payload.digest,
    disclosure: payload.disclosure,
    // F40 (plan 38 W6): the disclosure is keyed — the key names the charter
    // consent text this surface must render VERBATIM (D22), so an equality
    // test can pin it and a paraphrase can never pass.
    disclosureKey: payload.disclosure
      ? payload.tier === 'T2'
        ? 't2SandboxDisclosure'
        : 't0DeclarativeDisclosure'
      : null,
    changeSummary,
  };
}

export function updateConsentView(
  install: MiniAppSourceInstallView,
  candidate: SourceCandidate | undefined
): IntegrationConsentPayloadView | null {
  const update = install.update?.state === 'available' ? install.update : null;
  if (!update) {
    return null;
  }
  // The machine `changed` groups render once the kit publishes the
  // `IntegrationConsentChangeView.changed` contract field (changeset
  // staged: plan38-consent-change-summary → 0.69.0); the desktop rider
  // lands with the `^0.69.0` bump (8C kit-publish discipline).
  const changeSummary: IntegrationConsentChangeView = {
    addedCapabilities: update.manifestDiff.capabilitiesAdded,
    versionChange: { from: update.manifestDiff.versionFrom, to: update.manifestDiff.versionTo },
    digestChange: { from: install.digest, to: update.digest },
  };
  const variant = update.requiresReconsent ? ('re-consent' as const) : ('update' as const);
  if (candidate) {
    return consentView(candidate.consent, variant, changeSummary);
  }
  return consentView(
    {
      extensionId: install.extensionId,
      version: update.manifestDiff.versionTo,
      subpath: '',
      digest: update.digest,
      tier: 'T0',
      importClass: 'imported',
      originClass: 'imported',
      capabilities: [],
      provenance: install.provenance,
      disclosure: '',
    },
    variant,
    changeSummary
  );
}

export function installGroup(install: MiniAppSourceInstallView): IntegrationExtensionGroupView {
  const extension: IntegrationExtensionView = {
    id: install.extensionId,
    name: install.extensionId,
    version: install.version,
    summary: null,
    originClass: 'imported',
    tier: 'T0',
    kind: 'mini-app',
    provenance: install.provenance,
    digest: install.digest,
    update: updateView(install.update),
    metadata: { sourceId: install.sourceId },
  };
  const instance: IntegrationInstanceView = {
    id: install.extensionId,
    extensionId: install.extensionId,
    name: install.extensionId,
    enabled: install.enabled,
    status: install.error ? 'failing' : null,
    lastSuccessAt: isoTime(install.consentedAt),
    consecutiveFailures: null,
    conditions: [],
    originClass: 'imported',
    tier: 'T0',
    parked: install.parked,
    digest: install.digest,
    update: updateView(install.update),
    metadata: {
      sourceId: install.sourceId,
      pinRef: install.pinRef,
      consentedAt: install.consentedAt,
      parkedReason: install.parkedReason ?? null,
      absentFromSource: install.update?.state === 'absent-from-source',
      updateState: install.update?.state ?? null,
      requiresReconsent: install.update?.state === 'available' ? install.update.requiresReconsent : false,
    },
  };
  return { extension, instances: [instance] };
}

export function installGroups(installs: MiniAppSourceInstallView[]): IntegrationExtensionGroupView[] {
  const groups = new Map<string, IntegrationExtensionGroupView>();
  for (const install of installs) {
    if (!groups.has(install.extensionId)) {
      groups.set(install.extensionId, installGroup(install));
    }
  }
  return [...groups.values()];
}

function candidateView(
  candidate: SourceCandidate,
  installed: ReadonlySet<string>
): IntegrationDiscoveredView | null {
  if (installed.has(candidate.extensionId)) {
    return null;
  }
  return {
    extensionId: candidate.extensionId,
    name: null,
    digest: candidate.digest,
    ref: candidate.ref,
    compatible: candidate.compatible,
    reason: candidate.reason ?? null,
    tier: candidate.consent.tier,
    originClass: candidate.consent.originClass,
    consent: consentView(candidate.consent),
    provenance: candidate.consent.provenance,
    metadata: { subpath: candidate.subpath },
  };
}

export function sourceRow(
  source: MiniAppSourceView,
  installs: MiniAppSourceInstallView[]
): IntegrationSourceRowView {
  const sourceInstalls = installs.filter((install) => install.sourceId === source.id);
  const installed = new Set(sourceInstalls.map((install) => install.extensionId));
  return {
    id: source.id,
    kind: source.kind,
    origin: source.origin,
    status: source.status,
    error: source.error ?? null,
    lastCheckedAt: isoTime(source.lastCheckedAt),
    lastSuccessAt: isoTime(source.lastSuccessAt),
    consecutiveFailures: source.consecutiveFailures,
    refStrategy: source.ref ? sourceRefStrategy(source.ref.strategy) : null,
    refValue: source.ref?.value ?? null,
    gitops: false,
    candidates: source.candidates
      .map((candidate) => candidateView(candidate, installed))
      .filter((candidate): candidate is IntegrationDiscoveredView => candidate !== null),
    groups: installGroups(sourceInstalls),
  };
}

export function sourceRows(state: MiniAppSourcesState): IntegrationSourceRowView[] {
  return state.sources.map((source) => sourceRow(source, state.installs));
}

export function orphanGroups(state: MiniAppSourcesState): IntegrationExtensionGroupView[] {
  const known = new Set(state.sources.map((source) => source.id));
  return installGroups(state.installs.filter((install) => !known.has(install.sourceId)));
}

export function sourceDraftToDescriptor(draft: IntegrationSourceDraft): {
  descriptor: Record<string, unknown>;
  secrets: Record<string, string> | undefined;
} {
  const ref: Record<string, unknown> =
    draft.refStrategy === 'release-tag' || draft.refValue === ''
      ? { strategy: draft.refStrategy }
      : { strategy: draft.refStrategy, value: draft.refValue };
  const descriptor =
    draft.url !== ''
      ? { url: draft.url, ref, ...(draft.subpath ? { subpath: draft.subpath } : {}) }
      : { local: { path: draft.localPath }, ref, ...(draft.subpath ? { subpath: draft.subpath } : {}) };
  const secrets =
    draft.secretSlot && draft.secretValue ? { [draft.secretSlot]: draft.secretValue } : undefined;
  return { descriptor, secrets };
}
