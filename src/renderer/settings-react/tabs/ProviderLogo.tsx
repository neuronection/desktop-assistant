import { siAnthropic, siDeepseek, siGooglegemini, siMistralai, siOllama, siOpenrouter } from 'simple-icons';
import type { ProviderPresetKey } from '@shared/ai/providerPresets';
import type { JSX } from 'react';

const ICON_PATHS: Partial<Record<ProviderPresetKey, string>> = {
  gemini: siGooglegemini.path,
  openrouter: siOpenrouter.path,
  anthropic: siAnthropic.path,
  mistral: siMistralai.path,
  deepseek: siDeepseek.path,
  ollama: siOllama.path,
};

export function ProviderLogo({ presetKey, label }: { presetKey: ProviderPresetKey | null; label: string }): JSX.Element {
  const path = presetKey ? ICON_PATHS[presetKey] : undefined;
  if (path) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" fill="currentColor">
        <path d={path} />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--as-border)] text-[10px] font-semibold"
    >
      {label.charAt(0)}
    </span>
  );
}
