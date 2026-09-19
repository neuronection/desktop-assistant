import { LLMProvider, LLMProviderType, ModelCapability } from '@shared/types';
import {
  KEY_PREFIX_HINT_DATA,
  PROVIDER_PRESET_DATA,
  PROVIDER_PRESET_ORDER,
  type ProviderPresetData,
} from '@shared/ai/providerPresets.generated';

export { PROVIDER_PRESET_ORDER };

export type ProviderPresetKey = (typeof PROVIDER_PRESET_ORDER)[number];

export interface ProviderPresetModel {
  modelId: string;
  name: string;
  caps: ModelCapability[];
}

export interface ProviderPreset {
  key: ProviderPresetKey;
  label: string;
  type: LLMProviderType;
  apiBase: string;
  fixedBase: boolean;
  local: boolean;
  keyUrl?: string;
  preferredModel?: ProviderPresetModel;
  /** Curated model ids (D17): setup persists only these when the fetched catalog contains them. */
  curatedModels?: string[];
  /** Curated transcription model (D23): gap-fills the STT task when present in the catalog. */
  sttModel?: string;
  steps?: string[];
  freeTierNote?: string;
}

export interface KeyPrefixHint {
  prefix: string;
  presetKey: ProviderPresetKey;
}

const WIRE_TYPES: Record<string, LLMProviderType> = {
  openai_compatible: LLMProviderType.OPENAI,
  anthropic: LLMProviderType.ANTHROPIC,
  google: LLMProviderType.GOOGLE,
};

const KEY_TYPE_OVERRIDES: Partial<Record<ProviderPresetKey, LLMProviderType>> = {
  groq: LLMProviderType.GROQ,
  ollama: LLMProviderType.OLLAMA,
};

function toPreset(key: ProviderPresetKey, data: ProviderPresetData): ProviderPreset {
  const type = KEY_TYPE_OVERRIDES[key] ?? WIRE_TYPES[data.wireType];
  if (!type) {
    throw new Error(`Preset ${key} carries unknown wire type ${data.wireType}`);
  }
  return {
    key,
    label: data.label,
    type,
    apiBase: data.apiBase,
    fixedBase: data.fixedBase,
    local: data.local,
    ...(data.keyUrl ? { keyUrl: data.keyUrl } : {}),
    ...(data.preferredModel
      ? { preferredModel: { modelId: data.preferredModel.modelId, name: data.preferredModel.name, caps: data.preferredModel.caps as ModelCapability[] } }
      : {}),
    ...(data.curatedModels ? { curatedModels: data.curatedModels } : {}),
    ...(data.sttModel ? { sttModel: data.sttModel } : {}),
    ...(data.steps ? { steps: data.steps } : {}),
    ...(data.freeTierNote ? { freeTierNote: data.freeTierNote } : {}),
  };
}

function buildPresets(): Record<ProviderPresetKey, ProviderPreset> {
  const built = {} as Record<ProviderPresetKey, ProviderPreset>;
  for (const key of PROVIDER_PRESET_ORDER) {
    const data = PROVIDER_PRESET_DATA[key];
    if (!data) {
      throw new Error(`Canonical preset data missing for key ${key}`);
    }
    built[key] = toPreset(key, data);
  }
  return built;
}

export const PROVIDER_SETUP_PRESETS: Record<ProviderPresetKey, ProviderPreset> = buildPresets();

export const PROVIDER_SETUP_DEFAULTS = {
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
};

export function isProviderPresetKey(key: string): key is ProviderPresetKey {
  return (PROVIDER_PRESET_ORDER as readonly string[]).includes(key);
}

export const KEY_PREFIX_HINTS: readonly KeyPrefixHint[] = KEY_PREFIX_HINT_DATA.map((hint) => ({
  prefix: hint.prefix,
  presetKey: hint.presetKey as ProviderPresetKey,
}));

export function guessPresetForKey(apiKey: string): ProviderPresetKey | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return null;
  }
  const hint = KEY_PREFIX_HINTS.find((entry) => trimmed.startsWith(entry.prefix));
  return hint ? hint.presetKey : null;
}

export function isProviderConfigured(provider: LLMProvider): boolean {
  return Boolean(provider.apiKeyHint) || Boolean(provider.presetKey) || provider.type === LLMProviderType.OLLAMA;
}

export function hasConfiguredProvider(providers: LLMProvider[] | undefined): boolean {
  return (providers ?? []).some(isProviderConfigured);
}

export function presetKeyForProvider(provider: LLMProvider): ProviderPresetKey | null {
  if (provider.presetKey) {
    return isProviderPresetKey(provider.presetKey) ? provider.presetKey : null;
  }
  const match = (PROVIDER_PRESET_ORDER as readonly ProviderPresetKey[]).find(
    (key) => PROVIDER_SETUP_PRESETS[key].type === provider.type && PROVIDER_SETUP_PRESETS[key].apiBase === provider.apiBase
  );
  return match ?? null;
}
