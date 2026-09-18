import { AiTask } from '@shared/types';
import type { LLMProvider } from '@shared/types';
import type { TranslationMode, TranslationProviderConfig, TranslationProviderType } from '@shared/translation';
import type { ChatRequest } from './gateway';
import { recordAiCall } from './audit';

export const DEEPL_DEFAULT_API_BASE = 'https://api.deepl.com';
export const DEEPL_FREE_API_BASE = 'https://api-free.deepl.com';

export const MAX_TRANSLATE_INPUT_CHARS = 10_000;
export const TRANSLATION_RESULT_CHAR_CAP = 8_000;

export interface TranslationOutcome {
  text: string;
  engine: string;
  source?: string;
}

export interface TranslateMessage {
  role: 'system' | 'user';
  content: string;
}

export interface TranslationFetcherInput {
  config: TranslationProviderConfig;
  key: string | null;
  text: string;
  target: string;
  source?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export type TranslationFetcher = (input: TranslationFetcherInput) => Promise<TranslationOutcome>;

/** Filled per provider type by the service engines (plan 19 S2). */
export const TRANSLATION_FETCHERS: Partial<Record<TranslationProviderType, TranslationFetcher>> = {};

function joinUrl(base: string, path: string): string {
  const url = new URL(base);
  if (!url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return new URL(path, url).toString();
}

/** Trims and caps machine-translation output (no LLM-style wrap stripping). */
export function capTranslation(raw: string, cap: number = TRANSLATION_RESULT_CHAR_CAP): string {
  const text = raw.trim();
  return text.length > cap ? text.slice(0, cap).trimEnd() : text;
}

function auditServiceCall(
  config: TranslationProviderConfig,
  startedAt: number,
  run: () => Promise<TranslationOutcome>
): Promise<TranslationOutcome> {
  const finish = async (outcome: 'ok' | 'error', error?: unknown, result?: TranslationOutcome) => {
    await recordAiCall({
      task: 'translate',
      providerId: config.id,
      model: config.type,
      durationMs: Date.now() - startedAt,
      outcome,
      ...(error !== undefined ? { error: String((error as Error)?.message ?? error).slice(0, 500) } : {}),
    });
    if (error !== undefined) {
      throw error;
    }
    return result as TranslationOutcome;
  };
  return run().then(
    (result) => finish('ok', undefined, result),
    (error) => finish('error', error)
  );
}

async function readTranslationJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('unexpected payload');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${response.status}: non-JSON response (${body.slice(0, 120)})`);
  }
}

export async function translateWithDeepl(input: TranslationFetcherInput): Promise<TranslationOutcome> {
  const startedAt = Date.now();
  return auditServiceCall(input.config, startedAt, async () => {
    if (!input.key) {
      throw new Error('DeepL needs an API key.');
    }
    const base = input.config.apiBase?.trim() || (input.key.endsWith(':fx') ? DEEPL_FREE_API_BASE : DEEPL_DEFAULT_API_BASE);
    const response = await (input.fetchImpl ?? fetch)(joinUrl(base, 'v2/translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${input.key}` },
      body: JSON.stringify({
        text: [input.text],
        target_lang: input.target.toUpperCase(),
        ...(input.source ? { source_lang: input.source.toUpperCase() } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (response.status === 403) {
      throw new Error('HTTP 403 — DeepL rejected the API key.');
    }
    if (response.status === 456) {
      throw new Error('HTTP 456 — DeepL quota exceeded.');
    }
    const payload = await readTranslationJson(response);
    const translations = Array.isArray(payload.translations) ? (payload.translations as unknown[]) : [];
    const first = (typeof translations[0] === 'object' && translations[0] !== null ? translations[0] : {}) as Record<string, unknown>;
    const text = typeof first.text === 'string' ? first.text : '';
    if (!text.trim()) {
      throw new Error(`HTTP ${response.status} — DeepL returned no translation.`);
    }
    const detected = typeof first.detected_source_language === 'string' ? first.detected_source_language.toLowerCase() : undefined;
    return { text: capTranslation(text), engine: 'deepl', ...(detected ? { source: detected } : {}) };
  });
}

export async function translateWithLibretranslate(input: TranslationFetcherInput): Promise<TranslationOutcome> {
  const startedAt = Date.now();
  return auditServiceCall(input.config, startedAt, async () => {
    if (!input.config.apiBase?.trim()) {
      throw new Error('LibreTranslate needs a server URL in the instance settings.');
    }
    const response = await (input.fetchImpl ?? fetch)(joinUrl(input.config.apiBase.trim(), 'translate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: input.text,
        source: input.source ?? 'auto',
        target: input.target,
        format: 'text',
        ...(input.key ? { api_key: input.key } : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const payload = await readTranslationJson(response);
    if (typeof payload.error === 'string' && payload.error.trim()) {
      throw new Error(payload.error.slice(0, 200));
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}.`);
    }
    const text = typeof payload.translatedText === 'string' ? payload.translatedText : '';
    if (!text.trim()) {
      throw new Error(`HTTP ${response.status} — LibreTranslate returned no translation.`);
    }
    const detected = (payload.detectedLanguage as Record<string, unknown> | undefined)?.language;
    return {
      text: capTranslation(text),
      engine: 'libretranslate',
      ...(typeof detected === 'string' && input.source === undefined ? { source: detected } : {}),
    };
  });
}

TRANSLATION_FETCHERS.libretranslate = translateWithLibretranslate;
TRANSLATION_FETCHERS.deepl = translateWithDeepl;

export interface LlmTranslateDeps {
  invoke(request: ChatRequest): Promise<string>;
}

export interface LlmTranslateParams {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
  text: string;
  target: LanguageLabel;
  source?: LanguageLabel;
}

export interface LanguageLabel {
  code: string;
  name: string;
}

export function buildTranslationMessages(text: string, target: LanguageLabel, source?: LanguageLabel): TranslateMessage[] {
  const targetLabel = `${target.name} (${target.code})`;
  const sourceClause = source ? ` from ${source.name}` : ', detecting the source language automatically';
  const system = [
    `You are a translation engine. Translate the user's text${sourceClause} into ${targetLabel}.`,
    'Return ONLY the translated text — no explanations, notes, quotes around the whole answer, or comments.',
    'Preserve the original formatting: line breaks, lists, punctuation style, and inline code.',
  ].join(' ');
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];
}

export function normalizeTranslation(raw: string, cap: number = TRANSLATION_RESULT_CHAR_CAP): string {
  let text = raw.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text);
  if (fence) {
    text = fence[1].trim();
  }
  const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '„': '“' };
  const first = text[0];
  const last = text[text.length - 1];
  if (text.length >= 2 && first && last && pairs[first] === last && !text.slice(1, -1).includes(first)) {
    text = text.slice(1, -1).trim();
  }
  if (text.length > cap) {
    text = text.slice(0, cap).trimEnd();
  }
  return text;
}

export async function translateWithLlm(deps: LlmTranslateDeps, params: LlmTranslateParams): Promise<TranslationOutcome> {
  const messages = buildTranslationMessages(params.text, params.target, params.source);
  const raw = await deps.invoke({
    provider: params.provider,
    modelId: params.modelId,
    apiKey: params.apiKey,
    task: AiTask.TRANSLATE,
    messages,
    overrides: { temperature: 0 },
  });
  const text = normalizeTranslation(raw);
  if (!text) {
    throw new Error('Translation returned empty output.');
  }
  return { text, engine: 'llm' };
}

export type EngineStep = { kind: 'service'; provider: TranslationProviderConfig } | { kind: 'llm' };

export interface EnginePlan {
  steps: EngineStep[];
  errors: string[];
}

export function planEngines(
  mode: TranslationMode,
  providers: TranslationProviderConfig[],
  hasLlm: boolean
): EnginePlan {
  if (mode === 'llm') {
    return hasLlm
      ? { steps: [{ kind: 'llm' }], errors: [] }
      : { steps: [], errors: ['No translation model is assigned in settings.'] };
  }
  const enabled = providers.filter((provider) => provider.enabled);
  if (mode === 'service') {
    return enabled.length > 0
      ? { steps: enabled.map((provider) => ({ kind: 'service' as const, provider })), errors: [] }
      : { steps: [], errors: ['No translation service is configured. Add one in Settings → Tools → Translation.'] };
  }
  const steps: EngineStep[] = enabled.map((provider) => ({ kind: 'service' as const, provider }));
  if (hasLlm) {
    steps.push({ kind: 'llm' });
  }
  if (steps.length === 0) {
    return {
      steps: [],
      errors: ['Translation is not configured. Add a translation service or assign a translation model in settings.'],
    };
  }
  return { steps, errors: [] };
}
