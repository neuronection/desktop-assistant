import { v4 as uuidv4 } from 'uuid';
import { AiTask, LLMProvider, LLMProviderType, Model, SetupPresetOptions, SetupProviderResult } from '@shared/types';
import { AppConfig } from '@shared/config/AppConfig';
import { inferModelCaps, hasCap, findModel } from '@shared/ai/tasks';
import { DECISION_SLOTS } from '@shared/ai/decisions';
import {
  PROVIDER_SETUP_DEFAULTS,
  ALL_PROVIDER_PRESETS,
  ProviderPreset,
  isAnyPresetKey,
  isProviderPresetKey,
} from '@shared/ai/providerPresets';
import { classifyProviderError, extractErrorStatus } from '@shared/ai/providerErrors';
import { fetchProviderCatalog } from '@main/ai/catalog';
import { probeDecisionProvider } from '@main/ai/decide/systemone/probe';

export interface ProviderSetupStore {
  getConfig(): AppConfig;
  addLLMProvider(provider: Omit<LLMProvider, 'id'>): Promise<LLMProvider>;
  updateLLMProvider(provider: LLMProvider): Promise<void>;
  setDefaultLLMProvider(id: string): Promise<void>;
  updateConfig(updates: Partial<AppConfig>): Promise<void>;
  resolveSecret?(id: string): Promise<string | null>;
}

function resolveTargetRow(config: AppConfig, preset: ProviderPreset): LLMProvider | undefined {
  const providers = config.providers ?? [];
  return (
    providers.find((p) => p.presetKey === preset.key) ??
    providers.find((p) => !p.presetKey && p.type === preset.type && p.apiBase === preset.apiBase)
  );
}

/** Decision model rows a preset declares (plan 26 D5) — sparse `decision` cap + transport seam. */
function decisionModelRows(preset: ProviderPreset, providerId: string, providerType: LLMProviderType): Model[] {
  return (preset.decisionModels ?? []).map((decisionModel) => ({
    id: decisionModel.modelId,
    name: decisionModel.name,
    providerType,
    providerId,
    caps: ['decision'],
    decisionTransport: decisionModel.transport,
  }));
}

function draftFromPreset(preset: ProviderPreset, existing: LLMProvider | undefined, apiKey: string, name?: string): LLMProvider {
  if (existing) {
    return {
      ...existing,
      type: preset.type,
      apiBase: preset.apiBase,
      apiKey,
      presetKey: preset.key,
    };
  }
  return {
    id: uuidv4(),
    name: name?.trim() || preset.label,
    type: preset.type,
    apiKey,
    apiBase: preset.apiBase,
    presetKey: preset.key,
    timeout: PROVIDER_SETUP_DEFAULTS.timeout,
    temperature: PROVIDER_SETUP_DEFAULTS.temperature,
    maxTokens: PROVIDER_SETUP_DEFAULTS.maxTokens,
    systemPrompt: PROVIDER_SETUP_DEFAULTS.systemPrompt,
    availableModels: [],
    customModels: [],
  };
}

async function persistRow(
  store: ProviderSetupStore,
  draft: LLMProvider,
  existing: LLMProvider | undefined,
  catalog: Model[],
  decisionRows: Model[] = []
): Promise<LLMProvider> {
  if (existing) {
    const merged = (existing.availableModels ?? []).map((model) =>
      model.caps && model.caps.length > 0 ? model : { ...model, caps: inferModelCaps(model.id) }
    );
    for (const model of [...catalog, ...decisionRows]) {
      if (!merged.some((m) => m.id === model.id)) {
        merged.push(model);
      }
    }
    const saved: LLMProvider = { ...draft, availableModels: merged, customModels: existing.customModels ?? [] };
    await store.updateLLMProvider(saved);
    return saved;
  }
  const added = await store.addLLMProvider({ ...draft, availableModels: [], customModels: [] });
  const saved: LLMProvider = {
    ...added,
    availableModels: [...catalog, ...decisionRows].map((model) => ({ ...model, providerId: added.id })),
  };
  await store.updateLLMProvider(saved);
  return saved;
}

export async function setupProviderFromPreset(
  store: ProviderSetupStore,
  presetKey: string,
  apiKey: string,
  name?: string,
  options?: SetupPresetOptions
): Promise<SetupProviderResult> {
  if (!isAnyPresetKey(presetKey)) {
    return { ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown_preset', vendorMessage: null };
  }

  const preset = ALL_PROVIDER_PRESETS[presetKey];
  const decisionOnly = preset.type === LLMProviderType.DECISION;
  let key = preset.local && !decisionOnly ? '' : apiKey.trim();
  const config = store.getConfig();
  const existing = resolveTargetRow(config, preset);
  if (!key && existing && store.resolveSecret) {
    const stored = await store.resolveSecret(existing.id);
    if (stored) {
      key = stored;
    }
  }
  const draft = draftFromPreset(preset, existing, key, name);
  const decisionRows = decisionModelRows(preset, existing?.id ?? draft.id, preset.type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), draft.timeout || PROVIDER_SETUP_DEFAULTS.timeout);

  let catalog: Model[];
  if (decisionOnly) {
    try {
      // §15 single-source: a key-only probe derives its model id from the
      // preset's canonical decision data (decisionDefault → first decision
      // model) — never a code literal. A decision preset declaring neither
      // is a data inconsistency: classified failure, not an invented id.
      const probeId = preset.decisionDefault ?? preset.decisionModels?.[0]?.modelId ?? '';
      if (!probeId) {
        return {
          ok: false,
          assignedModelId: null,
          catalogCount: 0,
          errorCode: 'unknown',
          vendorMessage: 'preset declares no decision models',
          suspectedVendor: null,
        };
      }
      const probeModel = decisionRows[0] ?? {
        id: probeId,
        name: probeId,
        providerType: preset.type,
        providerId: draft.id,
        caps: ['decision'],
      };
      const probe = await probeDecisionProvider({
        provider: { ...draft, id: existing?.id ?? draft.id },
        model: probeModel,
        apiKey: key,
      });
      if (!probe.ok) {
        const classified = classifyProviderError({
          status: probe.status ?? extractErrorStatus(probe.error ?? ''),
          message: probe.error ?? 'decision probe failed',
          localProvider: preset.local,
          apiKey: key,
          ...(isProviderPresetKey(preset.key) ? { attemptedPreset: preset.key } : {}),
        });
        return {
          ok: false,
          assignedModelId: null,
          catalogCount: 0,
          errorCode: classified.code,
          vendorMessage: probe.error ?? null,
          suspectedVendor: classified.suspectedVendor ?? null,
        };
      }
      catalog = [];
    } finally {
      clearTimeout(timer);
    }
  } else {
    try {
      catalog = await fetchProviderCatalog(draft, key, { signal: controller.signal });
    } catch (error) {
      const err = error as Error;
      const classified = classifyProviderError({
        status: extractErrorStatus(err.message),
        message: err.message,
        name: err.name,
        localProvider: preset.local,
        apiKey: key,
        ...(isProviderPresetKey(preset.key) ? { attemptedPreset: preset.key } : {}),
      });
      return {
        ok: false,
        assignedModelId: null,
        catalogCount: 0,
        errorCode: classified.code,
        vendorMessage: err.message,
        suspectedVendor: classified.suspectedVendor ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const usePresetCurated = options?.curatedIds === undefined;
  const curated = usePresetCurated ? preset.curatedModels : options?.curatedIds;
  const cappedCatalog = catalog.map((model) => ({
    ...model,
    caps: model.caps && model.caps.length > 0 ? model.caps : inferModelCaps(model.id),
  }));
  const matchCurated = (modelId: string): string | null => {
    for (const curatedId of curated ?? []) {
      if (modelId === curatedId || modelId.startsWith(`${curatedId}-`)) {
        return curatedId;
      }
    }
    return null;
  };
  const anyCuratedMatch = cappedCatalog.some((model) => matchCurated(model.id) !== null);
  let persistCatalog: Model[];
  if (curated && curated.length > 0) {
    persistCatalog = anyCuratedMatch ? cappedCatalog.filter((model) => matchCurated(model.id) !== null) : usePresetCurated ? cappedCatalog : [];
  } else {
    persistCatalog = usePresetCurated ? cappedCatalog : [];
  }
  const curatedMissed = Boolean(usePresetCurated && curated && curated.length > 0 && !anyCuratedMatch);

  const saved = await persistRow(store, draft, existing, persistCatalog, decisionRows);

  const updates: Partial<AppConfig> = {};
  const liveConfig = store.getConfig();
  const assignmentAlive = (id: string | null): boolean =>
    id !== null && findModel(liveConfig, id) !== null;
  const chatAssignmentRaw = liveConfig.taskAssignments?.[AiTask.CHAT] ?? null;
  const visionAssignmentRaw = liveConfig.taskAssignments?.[AiTask.VISION] ?? null;
  const chatAssignment = assignmentAlive(chatAssignmentRaw) ? chatAssignmentRaw : null;
  const visionAssignment = assignmentAlive(visionAssignmentRaw) ? visionAssignmentRaw : null;
  let assignedModelId: string | null = null;
  let assignedVisionModelId: string | null = null;
  let assignedSttModelId: string | null = null;
  const assignedDecisionSlots: Record<string, string> = {};
  const preferred = preset.preferredModel;
  const preferredModelId = preferred?.modelId;
  const preferredResolvedId = preferredModelId
    ? persistCatalog.find((model) => model.id === preferredModelId || matchCurated(model.id) === preferredModelId)?.id ?? null
    : null;
  const fallbackCandidateId =
    (curated ?? [])
      .map((curatedId) => persistCatalog.find((model) => model.id === curatedId || matchCurated(model.id) === curatedId)?.id)
      .find((id): id is string => Boolean(id)) ?? null;
  const assignmentCandidateId = preferredResolvedId ?? fallbackCandidateId;
  const assignmentVisionCapable = preferredResolvedId
    ? preferred?.caps.includes('vision') ?? false
    : assignmentCandidateId
      ? inferModelCaps(assignmentCandidateId).includes('vision')
      : false;
  let visionCandidateId: string | null = null;
  let visionCapableFlag = false;
  const chatModel = chatAssignment ? persistCatalog.find((model) => model.id === chatAssignment) : undefined;
  const chatVisionCapable = Boolean(
    chatModel && (chatModel.caps?.includes('vision') ?? inferModelCaps(chatModel.id).includes('vision'))
  );
  if (chatAssignment && chatVisionCapable) {
    visionCandidateId = chatAssignment;
    visionCapableFlag = true;
  } else if (assignmentCandidateId) {
    visionCandidateId = assignmentCandidateId;
    visionCapableFlag = assignmentVisionCapable;
  }
  const nextAssignments = { ...liveConfig.taskAssignments };
  if (options?.bindChat !== false && assignmentCandidateId && !chatAssignment) {
    assignedModelId = assignmentCandidateId;
    nextAssignments[AiTask.CHAT] = assignmentCandidateId;
  }
  if (options?.bindVision !== false && visionCandidateId && visionCapableFlag && !visionAssignment) {
    assignedVisionModelId = visionCandidateId;
    nextAssignments[AiTask.VISION] = visionCandidateId;
  }
  const sttAssignmentRaw = liveConfig.taskAssignments?.[AiTask.STT] ?? null;
  const sttAssignment = assignmentAlive(sttAssignmentRaw) ? sttAssignmentRaw : null;
  const sttResolvedId = preset.sttModel
    ? persistCatalog.find((model) => model.id === preset.sttModel || matchCurated(model.id) === preset.sttModel)?.id ?? null
    : null;
  if (options?.bindStt !== false && sttResolvedId && !sttAssignment) {
    assignedSttModelId = sttResolvedId;
    nextAssignments[AiTask.STT] = sttResolvedId;
  }
  if (decisionRows.length > 0 && options?.bindDecision !== false && preset.decisionDefault) {
    const savedDecisionRows = (saved.availableModels ?? []).filter(
      (model) => model.decisionTransport === 'systemone' || (model.caps ?? []).includes('decision')
    );
    const decisionCandidate =
      savedDecisionRows.find((model) => model.id === preset.decisionDefault)?.id ??
      decisionRows.find((model) => model.id === preset.decisionDefault)?.id ??
      null;
    if (decisionCandidate) {
      for (const slot of DECISION_SLOTS) {
        const current = liveConfig.taskAssignments?.[slot] ?? null;
        if (!assignmentAlive(current)) {
          assignedDecisionSlots[slot] = decisionCandidate;
          nextAssignments[slot] = decisionCandidate;
        }
      }
    }
  }
  if (assignedModelId || assignedVisionModelId || assignedSttModelId || Object.keys(assignedDecisionSlots).length > 0) {
    updates.taskAssignments = nextAssignments;
  }
  if (!liveConfig.defaultProviderId) {
    updates.defaultProviderId = saved.id;
  }
  if (Object.keys(updates).length > 0) {
    await store.updateConfig(updates);
  }

  return {
    ok: true,
    provider: saved,
    assignedModelId,
    assignedVisionModelId,
    assignedSttModelId,
    ...(Object.keys(assignedDecisionSlots).length > 0 ? { assignedDecisionSlots } : {}),
    catalogCount: persistCatalog.length + decisionRows.length,
    curatedMissed,
  };
}

export async function setDefaultModel(
  store: ProviderSetupStore,
  providerId: string,
  modelId: string,
  task: AiTask | (string & {}) = AiTask.CHAT
): Promise<void> {
  const config = store.getConfig();
  const provider = (config.providers ?? []).find((p) => p.id === providerId);
  if (!provider) {
    throw new Error(`Provider with ID ${providerId} not found.`);
  }

  const registeredModel =
    [...(provider.availableModels ?? []), ...(provider.customModels ?? [])].find((model) => model.id === modelId);
  if (!registeredModel) {
    const elsewhere = (config.providers ?? [])
      .filter((p) => p.id !== providerId)
      .some((p) => [...(p.availableModels ?? []), ...(p.customModels ?? [])].some((model) => model.id === modelId));
    if (elsewhere) {
      throw new Error(`Model ${modelId} belongs to another provider.`);
    }
    const customModel: Model = {
      id: modelId,
      name: modelId,
      providerType: provider.type,
      providerId,
      caps: provider.type === LLMProviderType.DECISION ? ['decision'] : inferModelCaps(modelId),
      ...(provider.type === LLMProviderType.DECISION ? { decisionTransport: 'systemone' as const } : {}),
    };
    await store.updateLLMProvider({
      ...provider,
      customModels: [...(provider.customModels ?? []), customModel],
    });
  }

  const isDecisionSlot = task.startsWith('decision:');
  const caps = registeredModel?.caps ?? (provider.type === LLMProviderType.DECISION ? ['decision'] : inferModelCaps(modelId));
  const decisionCapable =
    provider.type === LLMProviderType.DECISION ||
    registeredModel?.decisionTransport === 'systemone' ||
    caps.includes('decision');
  if (isDecisionSlot) {
    if (task === 'decision:open-args' || !decisionCapable) {
      throw new Error(`Model ${modelId} does not serve ${task}.`);
    }
  } else if (decisionCapable) {
    throw new Error(`Model ${modelId} is a decision model — assign it to a decision slot.`);
  } else if (task === AiTask.VISION) {
    if (!hasCap({ id: modelId, name: modelId, providerType: provider.type, providerId, caps }, 'vision')) {
      throw new Error(`Model ${modelId} does not support vision.`);
    }
  }
  if (task === AiTask.STT) {
    if (!hasCap({ id: modelId, name: modelId, providerType: provider.type, providerId, caps }, 'stt')) {
      throw new Error(`Model ${modelId} does not support transcription.`);
    }
  }

  const updates: Partial<AppConfig> = {
    taskAssignments: { ...config.taskAssignments, [task]: modelId },
  };
  await store.updateConfig(updates);

  if (config.defaultProviderId !== providerId) {
    await store.setDefaultLLMProvider(providerId);
  }
}
