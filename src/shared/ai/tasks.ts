import { AiTask, LLMProvider, LLMProviderType, Model, ModelCapability, DEFAULT_MODEL_CAPS } from '@shared/types';
import { AppConfig } from '@shared/config/AppConfig';

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

export function findModel(config: AppConfig, modelId: string): { provider: LLMProvider; model: Model } | null {
  for (const provider of config.providers ?? []) {
    const models = [...(provider.availableModels ?? []), ...(provider.customModels ?? [])];
    const model = models.find((m) => m.id === modelId);
    if (model) {
      return { provider, model };
    }
  }
  return null;
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
 * Internal (non-user-visible) helper calls: the `plumbing` assignment
 * when set, otherwise the chat model. Cheap-model suggestion in the UI.
 */
export function resolveInternalModel(config: AppConfig): TaskModelResolution | null {
  return resolveTaskModel(config, AiTask.PLUMBING) ?? resolveTaskModel(config, AiTask.CHAT);
}

const VISION_ID_PATTERN = /(4o|gpt-5|vision|vl|claude|gemini)/i;
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
  return tuning;
}
