import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LLMProvider } from '@shared/types';

export interface ChatModelLike {
  invoke(messages: unknown[]): Promise<{ content?: unknown }>;
  stream(messages: unknown[]): AsyncIterable<{ content?: unknown }>;
}

export interface ModelOverrides {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
}

export type ModelFactory = (provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides) => ChatModelLike;

const temperatureIfSet = (value: number | undefined): { temperature: number } | Record<string, never> =>
  (value !== undefined ? { temperature: value } : {});

function buildChatOpenAI(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatOpenAI {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  return new ChatOpenAI({
    apiKey: apiKey || 'local-server',
    model: modelId,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(overrides?.reasoningEffort
      ? { reasoning: { effort: overrides.reasoningEffort as unknown as 'low' | 'medium' | 'high' } }
      : {}),
    configuration: {
      baseURL: provider.apiBase,
    },
  });
}

function buildChatAnthropic(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatAnthropic {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  return new ChatAnthropic({
    apiKey,
    model: modelId,
    ...temperatureIfSet(temperature),
    maxTokens: maxTokens ?? 4096,
    anthropicApiUrl: provider.apiBase && provider.apiBase !== 'https://api.anthropic.com' ? provider.apiBase : undefined,
  });
}

function buildChatGoogle(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatGoogleGenerativeAI {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  return new ChatGoogleGenerativeAI({
    apiKey,
    model: modelId,
    ...temperatureIfSet(temperature),
    ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
  });
}

export function createChatModel(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatModelLike {
  switch (provider.type) {
    case 'anthropic':
      return buildChatAnthropic(provider, modelId, apiKey, overrides) as unknown as ChatModelLike;
    case 'google':
      return buildChatGoogle(provider, modelId, apiKey, overrides) as unknown as ChatModelLike;
    default:
      return buildChatOpenAI(provider, modelId, apiKey, overrides) as unknown as ChatModelLike;
  }
}

/**
 * The factory is the only file allowed to hand out the real LangChain
 * model instance (needed by the agent's bindTools loop).
 */
export function createAgentModel(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): BaseChatModel {
  switch (provider.type) {
    case 'anthropic':
      return buildChatAnthropic(provider, modelId, apiKey, overrides) as unknown as BaseChatModel;
    case 'google':
      return buildChatGoogle(provider, modelId, apiKey, overrides) as unknown as BaseChatModel;
    default:
      return buildChatOpenAI(provider, modelId, apiKey, overrides) as unknown as BaseChatModel;
  }
}

const ANTHROPIC_SEARCH_MODEL_PATTERN = /^claude-(sonnet|opus|haiku)-(\d+)(?:[.-](\d+))?/;
const OPENAI_SEARCH_MODEL_PATTERN = /^gpt[-_.](\d+)(?:[.-](\d+))?/;
const OPENAI_SEARCH_MIN_MAJOR = 5;
const OPENAI_SEARCH_MIN_MINOR = 4;
const OPENAI_API_BASE = 'https://api.openai.com/v1';

/**
 * Provider tool search (plan 15 S3) is a server-side API feature of the
 * Anthropic and OpenAI APIs: Claude Sonnet 4+/Opus 4+/Haiku 4.5+ and
 * gpt-5.4+. The middleware throws on every other provider, and older
 * in-family models surface raw provider errors — so the gate runs here,
 * before the middleware is ever constructed. Third-party base URLs that
 * merely speak the OpenAI wire format do not implement tool search.
 */
export function supportsProviderToolSearch(
  provider: Pick<LLMProvider, 'type' | 'apiBase'>,
  modelId: string
): boolean {
  if (provider.type === 'anthropic') {
    const match = ANTHROPIC_SEARCH_MODEL_PATTERN.exec(modelId);
    if (!match) {
      return false;
    }
    const major = Number(match[2]);
    const minor = Number(match[3] ?? 0);
    if (match[1] === 'haiku') {
      return major > 4 || (major === 4 && minor >= 5);
    }
    return major >= 4;
  }
  if (provider.type === 'openai') {
    const base = provider.apiBase?.replace(/\/+$/, '');
    if (base && base !== OPENAI_API_BASE) {
      return false;
    }
    const match = OPENAI_SEARCH_MODEL_PATTERN.exec(modelId);
    if (!match) {
      return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2] ?? 0);
    return major > OPENAI_SEARCH_MIN_MAJOR || (major === OPENAI_SEARCH_MIN_MAJOR && minor >= OPENAI_SEARCH_MIN_MINOR);
  }
  return false;
}
