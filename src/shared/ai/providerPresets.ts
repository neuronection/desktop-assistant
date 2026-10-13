import { LLMProvider, LLMProviderType, ModelCapability } from '@shared/types';
import {
  KEY_PREFIX_HINT_DATA,
  PROVIDER_PRESET_DATA,
  PROVIDER_PRESET_ORDER,
  type DecisionModelData,
  type ProviderPresetData,
} from '@shared/ai/providerPresets.generated';

export { PROVIDER_PRESET_ORDER };
export type { DecisionModelData };

export type ProviderPresetKey = (typeof PROVIDER_PRESET_ORDER)[number];

/** Every canonical preset key (the `typesafe` exposure switch flipped 2026-10-13 — it now rides `presetOrder` like every preset). */
export type AnyPresetKey = keyof typeof PROVIDER_PRESET_DATA;

export interface ProviderPresetModel {
  modelId: string;
  name: string;
  caps: ModelCapability[];
}

export interface ProviderDecisionPresetModel {
  modelId: string;
  name: string;
  transport: 'systemone';
  baseUrlOverride?: string;
  provisional: boolean;
}

export interface ProviderPreset {
  key: string;
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
  /** Curated embeddings model (plan 26): gap-fills the `embed` task when present in the catalog. */
  embeddingsModel?: string;
  /** Decision models the preset declares (plan 26 D5) — appended as decision rows on setup. */
  decisionModels?: ProviderDecisionPresetModel[];
  /** Default decision binding for `bind_decision` gap-fill (D5). */
  decisionDefault?: string;
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
  decision: LLMProviderType.DECISION,
};

const KEY_TYPE_OVERRIDES: Partial<Record<string, LLMProviderType>> = {
  groq: LLMProviderType.GROQ,
  ollama: LLMProviderType.OLLAMA,
};

function toPreset(key: string, data: ProviderPresetData): ProviderPreset {
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
    ...(data.embeddingsModel ? { embeddingsModel: data.embeddingsModel } : {}),
    ...(data.decisionModels
      ? {
          decisionModels: data.decisionModels.map((decisionModel) => ({
            modelId: decisionModel.modelId,
            name: decisionModel.name,
            transport: decisionModel.transport,
            ...(decisionModel.baseUrlOverride ? { baseUrlOverride: decisionModel.baseUrlOverride } : {}),
            provisional: decisionModel.provisional === true || data.provisional === true,
          })),
        }
      : {}),
    ...(data.decisionDefault ? { decisionDefault: data.decisionDefault } : {}),
    ...(data.steps ? { steps: data.steps } : {}),
    ...(data.freeTierNote ? { freeTierNote: data.freeTierNote } : {}),
  };
}

function buildPresets(keys: readonly string[]): Record<string, ProviderPreset> {
  const built = {} as Record<string, ProviderPreset>;
  for (const key of keys) {
    const data = PROVIDER_PRESET_DATA[key];
    if (!data) {
      throw new Error(`Canonical preset data missing for key ${key}`);
    }
    built[key] = toPreset(key, data);
  }
  return built;
}

export const PROVIDER_SETUP_PRESETS: Record<ProviderPresetKey, ProviderPreset> = buildPresets(
  PROVIDER_PRESET_ORDER
) as Record<ProviderPresetKey, ProviderPreset>;

/**
 * Every canonical preset including ones outside `presetOrder` (plan 26
 * §13.3): the exposure switch flipped 2026-10-13 — the docs-verified
 * `typesafe` decision preset now rides `presetOrder` and tiles normally.
 */
export const ALL_PROVIDER_PRESETS: Record<string, ProviderPreset> = buildPresets(
  Object.keys(PROVIDER_PRESET_DATA)
);

export function isAnyPresetKey(key: string): key is AnyPresetKey {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PRESET_DATA, key);
}

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
