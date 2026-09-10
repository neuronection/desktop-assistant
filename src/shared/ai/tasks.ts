import { AiTask, LLMProvider, Model, ModelCapability, DEFAULT_MODEL_CAPS } from '@shared/types';
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
    if (found) {
      return { task, providerId: found.provider.id, modelId: found.model.id, provider: found.provider, model: found.model };
    }
  }
  return null;
}

const VISION_ID_PATTERN = /(4o|vision|vl|claude|gemini)/i;
const AUDIO_ID_PATTERN = /(whisper|tts|audio|speech)/i;
const EMBEDDING_ID_PATTERN = /(embed)/i;

export function inferModelCaps(externalId: string): ModelCapability[] {
  if (EMBEDDING_ID_PATTERN.test(externalId)) {
    return ['embeddings'];
  }
  if (AUDIO_ID_PATTERN.test(externalId)) {
    return ['audio'];
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
  const temperature = model.temperature ?? provider.temperature;
  const maxTokens = model.maxTokens ?? provider.maxTokens;
  if (isReasoning) {
    tuning.reasoningEffort = reasoningEffort;
    if (model.temperature !== undefined) {
      tuning.temperature = temperature;
    }
  } else {
    tuning.temperature = temperature;
    if (reasoningEffort === 'none') {
      tuning.reasoningEffort = 'none';
    }
  }
  if (maxTokens !== undefined) {
    tuning.maxTokens = maxTokens;
  }
  return tuning;
}
