import { LLMProvider, LLMProviderType, ModelCapability } from '@shared/types';

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
}

export const PROVIDER_PRESET_ORDER = [
  'openai',
  'gemini',
  'openrouter',
  'anthropic',
  'groq',
  'mistral',
  'deepseek',
  'ollama',
] as const;

export type ProviderPresetKey = (typeof PROVIDER_PRESET_ORDER)[number];

export const PROVIDER_SETUP_PRESETS: Record<ProviderPresetKey, ProviderPreset> = {
  openai: {
    key: 'openai',
    label: 'OpenAI',
    type: LLMProviderType.OPENAI,
    apiBase: 'https://api.openai.com/v1',
    fixedBase: false,
    local: false,
    keyUrl: 'https://platform.openai.com/api-keys',
    preferredModel: { modelId: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', caps: ['text', 'tools', 'vision'] },
  },
  gemini: {
    key: 'gemini',
    label: 'Google Gemini',
    type: LLMProviderType.GOOGLE,
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    fixedBase: true,
    local: false,
    keyUrl: 'https://aistudio.google.com/app/apikey',
    preferredModel: { modelId: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', caps: ['text', 'tools', 'vision'] },
  },
  openrouter: {
    key: 'openrouter',
    label: 'OpenRouter',
    type: LLMProviderType.OPENAI,
    apiBase: 'https://openrouter.ai/api/v1',
    fixedBase: false,
    local: false,
    keyUrl: 'https://openrouter.ai/settings/keys',
    preferredModel: { modelId: 'openrouter/auto', name: 'Auto (best match)', caps: ['text', 'tools'] },
  },
  anthropic: {
    key: 'anthropic',
    label: 'Anthropic',
    type: LLMProviderType.ANTHROPIC,
    apiBase: 'https://api.anthropic.com',
    fixedBase: true,
    local: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    preferredModel: { modelId: 'claude-sonnet-5', name: 'Claude Sonnet 5', caps: ['text', 'tools', 'vision'] },
  },
  groq: {
    key: 'groq',
    label: 'Groq',
    type: LLMProviderType.GROQ,
    apiBase: 'https://api.groq.com/openai/v1',
    fixedBase: false,
    local: false,
    keyUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    key: 'mistral',
    label: 'Mistral',
    type: LLMProviderType.OPENAI,
    apiBase: 'https://api.mistral.ai/v1',
    fixedBase: false,
    local: false,
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek',
    type: LLMProviderType.OPENAI,
    apiBase: 'https://api.deepseek.com/v1',
    fixedBase: false,
    local: false,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  ollama: {
    key: 'ollama',
    label: 'Ollama (local)',
    type: LLMProviderType.OLLAMA,
    apiBase: 'http://localhost:11434/v1',
    fixedBase: false,
    local: true,
  },
};

export const PROVIDER_SETUP_DEFAULTS = {
  timeout: 120000,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
};

export function isProviderPresetKey(key: string): key is ProviderPresetKey {
  return (PROVIDER_PRESET_ORDER as readonly string[]).includes(key);
}

export interface KeyPrefixHint {
  prefix: string;
  presetKey: ProviderPresetKey;
}

export const KEY_PREFIX_HINTS: readonly KeyPrefixHint[] = [
  { prefix: 'sk-ant-', presetKey: 'anthropic' },
  { prefix: 'sk-or-v1-', presetKey: 'openrouter' },
  { prefix: 'gsk_', presetKey: 'groq' },
  { prefix: 'AIza', presetKey: 'gemini' },
  { prefix: 'sk-', presetKey: 'openai' },
];

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
