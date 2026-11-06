import { type JSX } from 'react';
import { ModelPicker, type ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import type { ModelRegistryModel } from '@neuronection/assistant-ui/model-registry';
import { CapabilityDescriptor } from '@neuronection/assistant-ui/capability-chips';
import { Boxes, Eye, MessageSquare, Mic, Sparkles, Type, Volume2, Wrench, X } from 'lucide-react';
import { LLMProvider, LLMProviderType, Model } from '@shared/types';
import { AiTask } from '@shared/types';
import { inferModelCaps } from '@shared/ai/tasks';
import { DECISION_DEFAULT_SLOT } from '@shared/ai/decisions';
import { TEXT } from '@shared/constants/text';

/** The uniform "Default models" rows (ADR-0036 §4 ruling + ADR-0037
 * single-slot defaults): five capability defaults + the decision default,
 * one picker each. */
export const DEFAULT_ROW_TASKS = [
  { id: AiTask.CHAT, label: TEXT.API_TASK_CHAT, description: TEXT.API_TASK_CHAT_DESCRIPTION, requires: 'text', icon: MessageSquare },
  { id: AiTask.VISION, label: TEXT.API_TASK_VISION, description: TEXT.API_TASK_VISION_DESCRIPTION, requires: 'vision', icon: Eye },
  { id: AiTask.STT, label: TEXT.API_TASK_STT, description: TEXT.API_TASK_STT_DESCRIPTION, requires: 'stt', icon: Mic },
  { id: AiTask.TTS, label: TEXT.API_TASK_TTS, description: TEXT.API_TASK_TTS_DESCRIPTION, requires: 'tts', icon: Volume2 },
  { id: AiTask.EMBED, label: TEXT.API_TASK_EMBED, description: TEXT.API_TASK_EMBED_DESCRIPTION, requires: 'embeddings', icon: Boxes },
  { id: DECISION_DEFAULT_SLOT, label: TEXT.API_DECISION_DEFAULT_ROW_LABEL, description: TEXT.API_DECISION_DEFAULT_ROW_DESCRIPTION, requires: 'decision', icon: Sparkles },
];

export const CAP_DESCRIPTORS: CapabilityDescriptor[] = [
  { value: 'text', label: TEXT.API_CAP_TEXT, icon: Type },
  { value: 'vision', label: TEXT.API_CAP_VISION, icon: Eye },
  { value: 'tools', label: TEXT.API_CAP_TOOLS, icon: Wrench },
  { value: 'stt', label: TEXT.API_CAP_STT, icon: Mic },
  { value: 'tts', label: TEXT.API_CAP_TTS, icon: Volume2 },
  { value: 'embeddings', label: TEXT.API_CAP_EMBEDDINGS, icon: Boxes },
  { value: 'decision', label: TEXT.API_CAP_DECISION, icon: Sparkles },
];

export const REASONING_EFFORT_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high'];

/** Standalone kinds: selecting one makes the model exactly that kind —
 * chat caps combine, standalone kinds replace everything (D4 in the form). */
export const STANDALONE_CAPS = ['stt', 'tts', 'embeddings', 'decision'] as const;

/** Vision/tools imply text — every vision/tool-capable model is a text model too. */
export const CAP_IMPLICATIONS: Record<string, string[]> = { vision: ['text'], tools: ['text'] };

export const PROVIDER_PRESETS: Record<LLMProviderType, string> = {
  [LLMProviderType.OPENAI]: 'https://api.openai.com/v1',
  [LLMProviderType.ANTHROPIC]: 'https://api.anthropic.com',
  [LLMProviderType.GOOGLE]: 'https://generativelanguage.googleapis.com/v1beta',
  [LLMProviderType.GROQ]: 'https://api.groq.com/openai/v1',
  [LLMProviderType.TOGETHER]: 'https://api.together.xyz/v1',
  [LLMProviderType.FIREWORKS]: 'https://api.fireworks.ai/inference/v1',
  [LLMProviderType.OLLAMA]: 'http://localhost:11434/v1',
  [LLMProviderType.DECISION]: '',
};

export const PROVIDER_TYPE_LABELS: Partial<Record<LLMProviderType, string>> = {
  [LLMProviderType.ANTHROPIC]: 'Anthropic',
  [LLMProviderType.GOOGLE]: 'Google Gemini',
  [LLMProviderType.OLLAMA]: 'Ollama (local)',
  [LLMProviderType.DECISION]: TEXT.API_PROVIDER_TYPE_DECISION,
};

export const FIXED_BASE_URL_TYPES = new Set<LLMProviderType>([LLMProviderType.ANTHROPIC, LLMProviderType.GOOGLE]);

export interface DraftProvider extends LLMProvider {
  isNew?: boolean;
}

export const newProvider = (): DraftProvider => ({
  isNew: true,
  id: `new_${Date.now()}`,
  name: '',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: '',
  timeout: 120000,
  // No temperature: unset rides the provider default (ADR-0038 addendum).
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
  availableModels: [],
  customModels: [],
});

const compositeId = (providerId: string, modelId: string): string => `${providerId}:${modelId}`;

export const toRegistryModel = (provider: LLMProvider, model: Model): ModelRegistryModel => {
  const decisionProvider = provider.type === LLMProviderType.DECISION;
  return {
    id: compositeId(provider.id, model.id),
    providerId: provider.id,
    externalId: model.id,
    label: model.name !== model.id ? model.name : undefined,
    caps: model.caps && model.caps.length > 0 ? model.caps : decisionProvider ? ['decision'] : inferModelCaps(model.id),
    enabled: true,
    reasoningEffort: model.reasoningEffort,
    temperature: model.temperature ?? null,
    maxTokens: model.maxTokens ?? null,
    decisionTransport: model.decisionTransport,
  };
};

interface DecisionKindRowProps {
  slot: string
  label: string
  description: string
  icon: typeof Wrench
  catalog: ModelPickerProvider[]
  modelValue: string | null
  placeholder: string
  clearLabel: string
  onAssign: (slot: string, modelId: string | null) => void
  meta?: JSX.Element | null
}

/**
 * One Decision kinds group row (plan 29 / ADR-0036 D4 + uniform ruling,
 * 2026-10-14 single-picker contract): the row shape users know (icon
 * tile, one picker, X clears) composed app-side from the library
 * `ModelPicker` — an empty kind *is* the inherit state and the trigger's
 * placeholder names what it inherits from ("Inherits — {resolved default
 * model}"); the option list carries no explicit inherit entry. Fallback
 * stays a config/runtime concept — the UI no longer offers it.
 * `TaskAssignmentPicker` untouched.
 */
export function DecisionKindRow({
  slot,
  label,
  description,
  icon: Icon,
  catalog,
  modelValue,
  placeholder,
  clearLabel,
  onAssign,
  meta,
}: DecisionKindRowProps) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--as-radius-lg)] border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--as-radius)] bg-[var(--as-muted)] text-[var(--as-muted-fg)]">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--as-fg)]">{label}</p>
          <p className="truncate text-xs text-[var(--as-muted-fg)]">{description}</p>
          {meta ?? null}
        </div>
      </div>
      <div className="flex items-center gap-1.5 self-center">
        <ModelPicker
          providers={catalog}
          value={modelValue ?? ''}
          placeholder={placeholder}
          onChange={(modelId: string | null) => onAssign(slot, modelId)}
          clearable={false}
          label={label}
          hideLabel
          className="w-52"
        />
        {modelValue ? (
          <button
            type="button"
            aria-label={`${clearLabel} — ${label}`}
            onClick={() => onAssign(slot, null)}
            className="cursor-pointer rounded-[var(--as-radius-sm)] p-1.5 text-[var(--as-muted-fg)] transition-colors hover:bg-[var(--as-muted)] hover:text-[var(--as-fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--as-focus-ring)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
