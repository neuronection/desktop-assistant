import type { CustomLanguageEntry } from './languages';

export type TranslationMode = 'auto' | 'service' | 'llm';

export const TRANSLATION_MODES: TranslationMode[] = ['auto', 'service', 'llm'];

export type TranslationProviderType = 'libretranslate' | 'deepl';

export interface TranslationProviderConfig {
  id: string;
  name: string;
  type: TranslationProviderType;
  /**
   * LibreTranslate: server base URL (e.g. https://libretranslate.local).
   * DeepL: API base; empty = the official endpoint (free tier uses
   * https://api-free.deepl.com).
   */
  apiBase?: string;
  enabled: boolean;
  timeoutMs?: number;
  /** Masked key hint; the key itself lives only in the keyring. */
  keyHint?: string;
}

export interface TranslationSettings {
  mode: TranslationMode;
  /** ISO-639-1 default target for bare `/tr <text>`; null = required per call. */
  defaultTarget: string | null;
  /** Ordered service providers; array order = failover order. */
  providers: TranslationProviderConfig[];
  /** User-defined languages (custom codes/scripts) managed in settings. */
  customLanguages: CustomLanguageEntry[];
  /**
   * Translate-pad auto-send delay (plan 19 D11): ms after the last
   * keystroke before a request fires. Conservative by default — every
   * fired request is a billable engine call.
   */
  padDebounceMs: number;
}

export const TRANSLATION_PAD_DEBOUNCE_DEFAULT = 1500;
export const TRANSLATION_PAD_DEBOUNCE_MIN = 300;
export const TRANSLATION_PAD_DEBOUNCE_MAX = 10_000;

export function clampPadDebounce(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) {
    return TRANSLATION_PAD_DEBOUNCE_DEFAULT;
  }
  return Math.min(TRANSLATION_PAD_DEBOUNCE_MAX, Math.max(TRANSLATION_PAD_DEBOUNCE_MIN, n));
}

/** True when the provider type cannot run without a keyring secret. */
export function translationProviderRequiresKey(type: TranslationProviderType): boolean {
  return type === 'deepl';
}

/** Wire shape for the settings UI — never carries key material. */
export interface TranslationProviderView {
  config: TranslationProviderConfig;
  hasKey: boolean;
}

/** Renderer → main save payload; the only path key material may travel. */
export interface TranslationProviderSaveInput extends TranslationProviderConfig {
  /** undefined keeps the stored key, '' clears it, a value replaces it. */
  key?: string;
}

export interface TranslationProviderTestResult {
  ok: boolean;
  latencyMs?: number;
  /** The tiny test sentence translated back, when ok. */
  translation?: string;
  error?: string;
}

/** Wire shape of a finished translation (renderer bridge + service). */
export interface TranslationRunResult {
  text: string;
  /** 'deepl' | 'libretranslate' | 'llm' */
  engine: string;
  /** Resolved target language code (explicit or filled from config). */
  target: string;
  source?: string;
}
