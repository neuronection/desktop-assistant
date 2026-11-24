import { AiTask, LLMProvider, LLMProviderType, Model, ModelCapability, DEFAULT_MODEL_CAPS } from '@shared/types';
import type { AppConfig } from '@shared/config/AppConfig';

export interface TaskModelResolution {
  task: AiTask;
  providerId: string;
  modelId: string;
  provider: LLMProvider;
  model: Model;
}

export function modelCaps(model: Model): ModelCapability[] {
  return model.caps && model.caps.length > 0 ? model.caps : DEFAULT_MODEL_CAPS;
}

export function hasCap(model: Model, cap: ModelCapability): boolean {
  if (!model.caps || model.caps.length === 0) {
    return true;
  }
  return model.caps.includes(cap);
}

/**
 * A decision model row (plan 26 D2): explicit `decision` capability on a
 * transport seam. Decision-only providers (type `decision`) carry only
 * decision models, so their rows qualify implicitly.
 */
export function isDecisionModel(provider: LLMProvider, model: Model): boolean {
  if (provider.type === LLMProviderType.DECISION) {
    return true;
  }
  return model.decisionTransport === 'systemone' || (model.caps ?? []).includes('decision');
}

const MODEL_SELECTION_PREFIX = 'provider-model:';

export function modelSelectionKey(providerId: string, modelId: string): string {
  return MODEL_SELECTION_PREFIX + JSON.stringify([providerId, modelId]);
}

export function parseModelSelection(key: string): { providerId: string; modelId: string } | null {
  if (!key.startsWith(MODEL_SELECTION_PREFIX)) {
    return null;
  }
  try {
    const pair: unknown = JSON.parse(key.slice(MODEL_SELECTION_PREFIX.length));
    if (Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === 'string' && part.length > 0)) {
      return { providerId: pair[0], modelId: pair[1] };
    }
  } catch {
    return null;
  }
  return null;
}

interface ModelHit {
  provider: LLMProvider;
  model: Model;
}

function modelHits(config: Pick<AppConfig, 'providers'>, modelId: string): ModelHit[] {
  const hits: ModelHit[] = [];
  for (const provider of Array.isArray(config.providers) ? config.providers : []) {
    if (!provider) {
      continue;
    }
    const models = [...(provider.availableModels ?? []), ...(provider.customModels ?? [])];
    const model = models.find((m) => m?.id === modelId);
    if (model) {
      hits.push({ provider, model });
    }
  }
  return hits;
}

export function findModel(
  config: Pick<AppConfig, 'providers'> & { defaultProviderId?: string | null },
  selection: string
): { provider: LLMProvider; model: Model } | null {
  const qualified = parseModelSelection(selection);
  if (qualified) {
    return modelHits(config, qualified.modelId).find((hit) => hit.provider.id === qualified.providerId) ?? null;
  }
  const hits = modelHits(config, selection);
  if (hits.length > 1) {
    const preferred = hits.find((hit) => hit.provider.id === config.defaultProviderId);
    if (preferred) {
      return preferred;
    }
  }
  return hits[0] ?? null;
}

/**
 * The qualified key for a bare selection: only when exactly one provider
 * exposes the id and it is not a decision model. Ambiguous, unresolvable and
 * decision ids stay as written (qualifying one would turn the resolver's
 * slot-separation fall-through into a fail-closed null), and an already-
 * qualified value yields null.
 */
export function uniqueModelSelectionKey(config: Pick<AppConfig, 'providers'>, selection: string): string | null {
  if (parseModelSelection(selection)) {
    return null;
  }
  const hits = modelHits(config, selection);
  if (hits.length !== 1 || isDecisionModel(hits[0].provider, hits[0].model)) {
    return null;
  }
  return modelSelectionKey(hits[0].provider.id, selection);
}

export function resolveTaskModel(
  config: AppConfig,
  task: AiTask,
  preferredModelId?: string | null
): TaskModelResolution | null {
  const candidates = [
    preferredModelId,
    config.taskAssignments?.[task] ?? null,
    task === AiTask.CHAT ? config.defaultChatModelId ?? null : null,
  ];
  for (const modelId of candidates) {
    if (!modelId) {
      continue;
    }
    const found = findModel(config, modelId);
    // Slot separation (plan 26 D4): a decision model never satisfies a
    // text/vision/… task; a decision-only provider never serves chat.
    if (parseModelSelection(modelId) && (!found || isDecisionModel(found.provider, found.model))) {
      return null;
    }
    if (found && isDecisionModel(found.provider, found.model)) {
      continue;
    }
    if (found) {
      return { task, providerId: found.provider.id, modelId: found.model.id, provider: found.provider, model: found.model };
    }
  }
  return null;
}

/**
 * OCR resolution (plan 82): `ocr → vision → chat`, each candidate filtered to
 * a vision-capable model. One named resolver so the chain cannot drift between
 * the settings row, the capability report and the call site.
 */
export function resolveOcrModel(config: AppConfig): TaskModelResolution | null {
  for (const task of [AiTask.OCR, AiTask.VISION, AiTask.CHAT]) {
    const resolution = resolveTaskModel(config, task);
    if (resolution && hasCap(resolution.model, 'vision')) {
      return resolution;
    }
  }
  return null;
}

/**
 * Internal (non-user-visible) helper calls: the `plumbing` assignment
 * when set, otherwise the chat model. Cheap-model suggestion in the UI.
 */
export function resolveInternalModel(config: AppConfig): TaskModelResolution | null {
  return resolveTaskModel(config, AiTask.PLUMBING) ?? resolveTaskModel(config, AiTask.CHAT);
}

const VISION_ID_PATTERN = /(4o|gpt-5|gpt-6|vision|vl|claude|gemini)/i;
const STT_ID_PATTERN = /(whisper|transcribe|stt)/i;
const TTS_ID_PATTERN = /(tts|speech|voice)/i;
const EMBEDDING_ID_PATTERN = /(embed)/i;

export function inferModelCaps(externalId: string): ModelCapability[] {
  if (EMBEDDING_ID_PATTERN.test(externalId)) {
    return ['embeddings'];
  }
  if (STT_ID_PATTERN.test(externalId)) {
    return ['stt'];
  }
  if (TTS_ID_PATTERN.test(externalId)) {
    return ['tts'];
  }
  const caps: ModelCapability[] = ['text', 'tools'];
  if (VISION_ID_PATTERN.test(externalId)) {
    caps.push('vision');
  }
  return caps;
}

export interface ModelTuning {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  chatTransport?: string;
}

export function modelTuning(provider: LLMProvider, model: Model): ModelTuning {
  const tuning: ModelTuning = {};
  const reasoningEffort = model.reasoningEffort ?? undefined;
  const isReasoning = reasoningEffort !== undefined && reasoningEffort !== 'none';
  // Temperature is omit-unless-configured (ADR-0038 addendum): when neither
  // the model row nor the provider carries an explicit value, nothing is
  // sent and the provider default applies — the only value reasoning
  // families accept.
  const temperature = model.temperature ?? provider.temperature;
  const maxTokens = model.maxTokens ?? provider.maxTokens;
  if (isReasoning) {
    tuning.reasoningEffort = reasoningEffort;
    if (model.temperature !== undefined) {
      tuning.temperature = temperature;
    }
  } else {
    if (temperature !== undefined) {
      tuning.temperature = temperature;
    }
    if (reasoningEffort === 'none') {
      tuning.reasoningEffort = 'none';
    }
  }
  if (maxTokens !== undefined) {
    tuning.maxTokens = maxTokens;
  }
  // Model-scoped transport knob (ADR-0039): unset = auto = completions.
  if (model.chatTransport !== undefined) {
    tuning.chatTransport = model.chatTransport;
  }
  return tuning;
}
