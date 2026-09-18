import { AiTask } from '@shared/types';
import type { LLMProvider } from '@shared/types';
import type { TranslationMode, TranslationProviderConfig, TranslationProviderType } from '@shared/translation';
import { findLanguage } from '@shared/languages';
import type { ChatRequest } from './gateway';

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

export interface LlmTranslateDeps {
  invoke(request: ChatRequest): Promise<string>;
}

export interface LlmTranslateParams {
  provider: LLMProvider;
  modelId: string;
  apiKey: string;
  text: string;
  target: string;
  source?: string;
}

export function buildTranslationMessages(text: string, target: string, source?: string): TranslateMessage[] {
  const entry = findLanguage(target);
  const targetLabel = entry ? `${entry.name} (${entry.code})` : target;
  const sourceClause = source ? ` from ${findLanguage(source)?.name ?? source}` : ', detecting the source language automatically';
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
