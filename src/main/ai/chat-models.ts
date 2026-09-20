import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import { z } from 'zod';
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

/**
 * OpenAI's reasoning families (o-series, gpt-5) reject any non-default
 * sampling temperature with a hard 400 ("Only the default (1) value is
 * supported") — pinning `temperature: 0` for deterministic tasks must
 * degrade to the model default there instead of failing the call.
 */
const OPENAI_TEMPERATURE_LOCKED_PATTERN = /^(o\d|gpt-5)/;

function buildChatOpenAI(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatOpenAI {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  const temperatureLocked = OPENAI_TEMPERATURE_LOCKED_PATTERN.test(modelId);
  return new ChatOpenAI({
    apiKey: apiKey || 'local-server',
    model: modelId,
    ...(temperature !== undefined && !temperatureLocked ? { temperature } : {}),
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

function buildChatGoogle(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatGoogle {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  return new ChatGoogle({
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

export interface StructuredModelLike {
  invoke(input: BaseMessageLike[]): Promise<unknown>;
}

export type StructuredModelFactory = (
  provider: LLMProvider,
  modelId: string,
  apiKey: string,
  schema: unknown,
  overrides?: ModelOverrides
) => StructuredModelLike;

/**
 * Providers reject JSON Schema keywords their structured-output subset
 * does not implement: Gemini's response schema 400s on "Unknown name
 * …" (`propertyNames`, `additionalProperties`, `$schema`, `default`),
 * and OpenAI's `response_format` validator refuses `propertyNames` the
 * same way ("… is not permitted"). Free-form `z.record` args map onto
 * exactly those keywords, so the zod schema is converted here and
 * pruned before binding — for every provider. Output validation stays
 * with the caller's zod parse — this only shapes what the model is
 * allowed to emit.
 */
export function wireSafeResponseSchema(schema: unknown): Record<string, unknown> {
  const json = z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>;
  const prune = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(prune);
      return;
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      delete record.propertyNames;
      delete record.additionalProperties;
      delete record.$schema;
      delete record.default;
      for (const value of Object.values(record)) {
        prune(value);
      }
    }
  };
  prune(json);
  return json;
}

/**
 * Structured-output model seam (plan 20 decision engines): same factory
 * boundary as `createAgentModel` — provider SDKs stay in this file, the
 * zod schema is bound by the caller.
 */
export function createStructuredChatModel(
  provider: LLMProvider,
  modelId: string,
  apiKey: string,
  schema: unknown,
  overrides?: ModelOverrides
): StructuredModelLike {
  const model = createAgentModel(provider, modelId, apiKey, overrides);
  console.log('[llm] structured output — response schema pruned to provider-safe keywords');
  return model.withStructuredOutput(wireSafeResponseSchema(schema) as Parameters<
    BaseChatModel['withStructuredOutput']
  >[0]);
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
