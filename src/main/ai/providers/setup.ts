import { v4 as uuidv4 } from 'uuid';
import { AiTask, LLMProvider, Model, SetupPresetOptions, SetupProviderResult } from '@shared/types';
import { AppConfig } from '@shared/config/AppConfig';
import { inferModelCaps, hasCap, findModel } from '@shared/ai/tasks';
import {
  PROVIDER_SETUP_DEFAULTS,
  PROVIDER_SETUP_PRESETS,
  ProviderPreset,
  isProviderPresetKey,
} from '@shared/ai/providerPresets';
import { classifyProviderError, extractErrorStatus } from '@shared/ai/providerErrors';
import { fetchProviderCatalog } from '@main/ai/catalog';

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
  catalog: Model[]
): Promise<LLMProvider> {
  if (existing) {
    const merged = (existing.availableModels ?? []).map((model) =>
      model.caps && model.caps.length > 0 ? model : { ...model, caps: inferModelCaps(model.id) }
    );
    for (const model of catalog) {
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
    availableModels: catalog.map((model) => ({ ...model, providerId: added.id })),
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
  if (!isProviderPresetKey(presetKey)) {
    return { ok: false, assignedModelId: null, catalogCount: 0, errorCode: 'unknown_preset', vendorMessage: null };
  }

  const preset = PROVIDER_SETUP_PRESETS[presetKey];
  let key = preset.local ? '' : apiKey.trim();
  const config = store.getConfig();
  const existing = resolveTargetRow(config, preset);
  if (!key && existing && store.resolveSecret) {
    const stored = await store.resolveSecret(existing.id);
    if (stored) {
      key = stored;
    }
  }
  const draft = draftFromPreset(preset, existing, key, name);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), draft.timeout || PROVIDER_SETUP_DEFAULTS.timeout);

  let catalog: Model[];
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
      attemptedPreset: preset.key,
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

  const saved = await persistRow(store, draft, existing, persistCatalog);

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
  const preferred = preset.preferredModel;
  const preferredModelId = preferred?.modelId;
  const preferredResolvedId = preferredModelId
    ? persistCatalog.find((model) => model.id === preferredModelId || matchCurated(model.id) === preferredModelId)?.id ?? null
    : null;
  const fallbackCandidateId =
    (curated ?? [])
      .map((curatedId) => persistCatalog.find((model) => matchCurated(model.id) === curatedId)?.id)
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
  if (assignedModelId || assignedVisionModelId) {
    updates.taskAssignments = nextAssignments;
  }
  if (!liveConfig.defaultProviderId) {
    updates.defaultProviderId = saved.id;
  }
  if (Object.keys(updates).length > 0) {
    await store.updateConfig(updates);
  }

  return { ok: true, provider: saved, assignedModelId, assignedVisionModelId, catalogCount: persistCatalog.length, curatedMissed };
}

export async function setDefaultModel(
  store: ProviderSetupStore,
  providerId: string,
  modelId: string,
  task: AiTask = AiTask.CHAT
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
      caps: inferModelCaps(modelId),
    };
    await store.updateLLMProvider({
      ...provider,
      customModels: [...(provider.customModels ?? []), customModel],
    });
  }

  if (task === AiTask.VISION) {
    const caps = registeredModel?.caps ?? inferModelCaps(modelId);
    if (!hasCap({ id: modelId, name: modelId, providerType: provider.type, providerId, caps }, 'vision')) {
      throw new Error(`Model ${modelId} does not support vision.`);
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
