import type { LLMProvider, Model } from '@shared/types';
import { LLMProviderType } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';
import { findModel } from '@shared/ai/tasks';
import {
  DECISION_DEFAULT_SLOT,
  DECISION_TRANSPORT_NAMES,
  SYSTEMONE_DECISION_CAPS,
  decisionSlot,
  type DecisionCapability,
  type DecisionTransport,
  type EngineReadiness,
} from '@shared/ai/decisions';
import type { DecisionEngine } from './types';
import { SystemOneDecisionEngine } from './systemone/engine';
import {
  KEYLESS_SYSTEMONE_API_KEY,
  isKeylessSystemOnePreset,
  resolveSystemOneBaseUrl,
} from './systemone/client';

export interface DecisionEngineDeps {
  getApiKey(provider: LLMProvider): Promise<string | null>;
  /** Config revision for the resolution cache (voice hot path, plan 26 S1); absent = uncached. */
  configRevision?(): number;
  /** Records a provider-reported model version (plan 26 D10) for the settings pin affordance. */
  observeResolvedModel?(modelId: string, resolvedModel: string): Promise<void>;
  /** Injectable transport for tests / proxies. */
  fetchImpl?: typeof fetch;
}

export type DecisionResolution =
  | { kind: 'off' }
  | { kind: 'unconfigured'; reason: string }
  | { kind: 'unavailable'; reason: string; code?: 'needs-key'; providerId?: string }
  | { kind: 'systemone'; provider: LLMProvider; model: Model; apiKey: string; baseUrl: string };

/**
 * One registration per transport (plan 24 D2 → plan 26 D6): adding a
 * transport is one file plus one entry here; callers never switch on
 * transport. `resolve` receives a slot candidate that already passed the
 * capability matrix (D2b) and completes the provider-side checks.
 */
export interface DecisionTransportRegistration {
  transport: DecisionTransport;
  capabilities: ReadonlySet<DecisionCapability>;
  displayName: string;
  resolveCandidate(
    provider: LLMProvider,
    model: Model,
    deps: DecisionEngineDeps
  ): Promise<DecisionResolution>;
  create(resolution: DecisionResolution, deps: DecisionEngineDeps): Promise<DecisionEngine>;
  audit(resolution: DecisionResolution): { providerId?: string; model: string } | null;
}

const systemoneRegistration: DecisionTransportRegistration = {
  transport: 'systemone',
  capabilities: new Set<DecisionCapability>(SYSTEMONE_DECISION_CAPS),
  displayName: DECISION_TRANSPORT_NAMES.systemone,
  async resolveCandidate(provider, model, deps) {
    const baseUrl = resolveSystemOneBaseUrl(provider, model);
    if (!baseUrl) {
      return { kind: 'unavailable', reason: 'The provider base URL is missing or invalid.' };
    }
    let apiKey = await deps.getApiKey(provider);
    if (!apiKey) {
      if (!isKeylessSystemOnePreset(provider)) {
        return {
          kind: 'unavailable',
          reason: 'No API key is set for the decision provider.',
          code: 'needs-key',
          providerId: provider.id,
        };
      }
      apiKey = KEYLESS_SYSTEMONE_API_KEY;
    }
    return { kind: 'systemone', provider, model, apiKey, baseUrl };
  },
  async create(resolution, deps) {
    if (resolution.kind !== 'systemone') {
      throw new Error('systemone registration received a non-systemone resolution');
    }
    return new SystemOneDecisionEngine({
      apiKey: resolution.apiKey,
      baseUrl: resolution.baseUrl,
      model: resolution.model.id,
      ...(deps.fetchImpl ? { fetcher: deps.fetchImpl } : {}),
    });
  },
  audit(resolution) {
    return resolution.kind === 'systemone'
      ? { providerId: resolution.provider.id, model: resolution.model.id }
      : null;
  },
};

const REGISTRATIONS: Record<DecisionTransport, DecisionTransportRegistration> = {
  systemone: systemoneRegistration,
};

export function getDecisionTransportRegistration(
  transport: DecisionTransport
): DecisionTransportRegistration {
  return REGISTRATIONS[transport];
}

export function decisionTransportCapabilities(transport: DecisionTransport): ReadonlySet<DecisionCapability> {
  return REGISTRATIONS[transport].capabilities;
}

export function decisionTransportDisplayName(transport: DecisionTransport): string {
  return REGISTRATIONS[transport].displayName;
}

/** The transport a model row carries; decision-only providers imply `systemone`. */
export function decisionTransportOf(provider: LLMProvider, model: Model): DecisionTransport | null {
  if (model.decisionTransport) {
    return model.decisionTransport;
  }
  return provider.type === LLMProviderType.DECISION ? 'systemone' : null;
}

/**
 * ADR-0037: capability defaults are single-slot — the `decision` default
 * carries a primary only. The kind overrides keep their per-assignment
 * fallback (the kind row is this slot's specialist when memory of the
 * old four-slot shape remains, ADR-0036 rule 2).
 */
function assignedCandidates(config: AppConfig, capability: DecisionCapability): string[] {
  const slot = decisionSlot(capability);
  const primary = config.taskAssignments?.[slot];
  const fallback = config.taskFallbackAssignments?.[slot];
  const kindCandidates = [primary, fallback].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
  if (kindCandidates.length > 0) {
    return kindCandidates;
  }
  // ADR-0036 §2 resolution order: an empty kind slots inherits the
  // `decision` default (single-slot — primary only, never a third hop).
  return [config.taskAssignments?.[DECISION_DEFAULT_SLOT]].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
}

/** The inherit view of a kind (ADR-0036 §4): what the default slot alone serves. */
function defaultSlotCandidates(config: AppConfig): string[] {
  const primary = config.taskAssignments?.[DECISION_DEFAULT_SLOT];
  return [primary].filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
}

let cachedRevision: number | null = null;
const resolutionCache = new Map<string, Promise<DecisionResolution>>();

/** Test seam: drops the per-revision resolution cache. */
export function clearDecisionResolutionCache(): void {
  cachedRevision = null;
  resolutionCache.clear();
}

async function computeResolution(
  capability: DecisionCapability,
  config: AppConfig,
  deps: DecisionEngineDeps
): Promise<DecisionResolution> {
  const candidates = assignedCandidates(config, capability);
  if (candidates.length === 0) {
    return { kind: 'off' };
  }
  const rejections: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const modelId = candidates[index];
    const found = findModel(config, modelId);
    if (!found) {
      rejections.push(`Model '${modelId}' is not registered.`);
      continue;
    }
    const transport = decisionTransportOf(found.provider, found.model);
    if (!transport || !found.model.caps?.includes('decision')) {
      rejections.push(`Model '${modelId}' is not a decision model.`);
      continue;
    }
    const registration = REGISTRATIONS[transport];
    if (!registration.capabilities.has(capability)) {
      rejections.push(`The transport of '${modelId}' does not serve ${decisionSlot(capability)}.`);
      continue;
    }
    const resolution = await registration.resolveCandidate(found.provider, found.model, deps);
    if (resolution.kind !== 'unavailable' || index === candidates.length - 1) {
      return resolution;
    }
    rejections.push(resolution.reason);
  }
  return { kind: 'unconfigured', reason: rejections[0] ?? 'No decision model is assigned.' };
}

/**
 * Slot resolution (plan 26 D6): `decision:<cap>` assignment → model row →
 * provider row, capability routing enforced (D2b/D4), fallback chain →
 * fall-through. `off` is a resolution result (unassigned slot), never a
 * transport. Cached per config revision — the voice hot path must not hit
 * the keyring per phrase.
 */
export function resolveDecision(
  capability: DecisionCapability,
  config: AppConfig,
  deps: DecisionEngineDeps
): Promise<DecisionResolution> {
  const revision = deps.configRevision?.() ?? null;
  if (revision === null) {
    return computeResolution(capability, config, deps);
  }
  if (cachedRevision !== revision) {
    cachedRevision = revision;
    resolutionCache.clear();
  }
  const key = `${capability}`;
  const cached = resolutionCache.get(key);
  if (cached) {
    return cached;
  }
  const pending = computeResolution(capability, config, deps).catch((error) => {
    resolutionCache.delete(key);
    throw error;
  });
  resolutionCache.set(key, pending);
  return pending;
}

/** The transport behind a runnable resolution — the one resolution switch. */
export function resolutionTransport(resolution: DecisionResolution): DecisionTransport | null {
  return resolution.kind === 'systemone' ? 'systemone' : null;
}

/**
 * The inherit view of a kind (ADR-0036 §4): what the `decision` default
 * slot alone would serve — the model the kind picker's labeled null
 * option names. Same validation walk as computeResolution over the
 * default candidates only; cached under its own revision-checked key.
 */
export function resolveDecisionInherit(
  capability: DecisionCapability,
  config: AppConfig,
  deps: DecisionEngineDeps
): Promise<DecisionResolution> {
  const revision = deps.configRevision?.() ?? null;
  const compute = async (): Promise<DecisionResolution> => {
    const candidates = defaultSlotCandidates(config);
    if (candidates.length === 0) {
      return { kind: 'off' };
    }
    const rejections: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const modelId = candidates[index];
      const found = findModel(config, modelId);
      if (!found) {
        rejections.push(`Model '${modelId}' is not registered.`);
        continue;
      }
      const transport = decisionTransportOf(found.provider, found.model);
      if (!transport || !found.model.caps?.includes('decision')) {
        rejections.push(`Model '${modelId}' is not a decision model.`);
        continue;
      }
      const registration = REGISTRATIONS[transport];
      if (!registration.capabilities.has(capability)) {
        rejections.push(`The transport of '${modelId}' does not serve ${decisionSlot(capability)}.`);
        continue;
      }
      const resolution = await registration.resolveCandidate(found.provider, found.model, deps);
      if (resolution.kind !== 'unavailable' || index === candidates.length - 1) {
        return resolution;
      }
      rejections.push(resolution.reason);
    }
    return { kind: 'unconfigured', reason: rejections[0] ?? 'No decision model is assigned.' };
  };
  if (revision === null) {
    return compute();
  }
  if (cachedRevision !== revision) {
    cachedRevision = revision;
    resolutionCache.clear();
  }
  const key = `inherit:${capability}`;
  const cached = resolutionCache.get(key);
  if (cached) {
    return cached;
  }
  const pending = compute().catch((error) => {
    resolutionCache.delete(key);
    throw error;
  });
  resolutionCache.set(key, pending);
  return pending;
}

/** Maps a resolution to the generic settings readiness (plan 24 D7). */
export function engineReadiness(resolution: DecisionResolution): EngineReadiness {
  if (resolution.kind === 'systemone') {
    return { state: 'ready' };
  }
  if (resolution.kind === 'off') {
    return { state: 'unavailable', reason: 'No decision model is assigned.' };
  }
  if (resolution.kind === 'unavailable' && resolution.code === 'needs-key') {
    return { state: 'needs-key', secretId: `provider:${resolution.providerId ?? ''}` };
  }
  return { state: 'unavailable', reason: resolution.reason };
}
