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
