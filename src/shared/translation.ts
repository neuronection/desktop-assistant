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
}
