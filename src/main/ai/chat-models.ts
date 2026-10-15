import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessageLike } from '@langchain/core/messages';
import { z } from 'zod';
import { LLMProvider, LLMProviderType } from '@shared/types';

export interface ChatModelLike {
  invoke(messages: unknown[]): Promise<{ content?: unknown }>;
  stream(messages: unknown[]): AsyncIterable<{ content?: unknown }>;
}

export interface ModelOverrides {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  chatTransport?: string;
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

/**
 * Gateways prefix upstream model ids (`openai/gpt-5.6-terra` on an
 * OpenAI-compatible proxy); family detection must look at the bare id,
 * never at the prefixed wire name.
 */
function bareModelId(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

export type MaxTokensParamMode = 'max_tokens' | 'max_completion_tokens' | 'none';

const OPENAI_API_HOST = 'api.openai.com';

/**
 * True when the base URL points at OpenAI's own API. Declared provider
 * types cannot decide this — desktop registers api.openai.com providers
 * as `openai`/`openai_compatible` alike (plan 21 presets), and any type
 * may be pointed at a proxy. Endpoint wins, mirroring career-assistant's
 * `is_openai_endpoint`.
 */
export function isOpenAIApiBase(apiBase: string | undefined): boolean {
  if (!apiBase || !apiBase.trim()) {
    return false;
  }
  try {
    return new URL(apiBase).hostname === OPENAI_API_HOST;
  } catch {
    return false;
  }
}

/**
 * Which wire parameter carries the output-token cap (ADR-0038)?
 *
 * Model ids are the wrong signal — the families evolve (`gpt-5-chat*`,
 * prefixed gateway ids, future lines) and every id regex eventually lies.
 * Endpoints are the contract carrier: OpenAI's own API accepts
 * `max_completion_tokens` on every chat model, old and new, while
 * OpenAI-compatible servers (Ollama, LM Studio, llama.cpp, OpenRouter…)
 * standardized on `max_tokens`. An explicit provider override beats both.
 */
export function resolveMaxTokensParam(
  provider: Pick<LLMProvider, 'type' | 'apiBase' | 'maxTokensParam'>
): MaxTokensParamMode {
  const override = provider.maxTokensParam ?? 'auto';
  if (override === 'max_tokens' || override === 'max_completion_tokens' || override === 'none') {
    return override;
  }
  return isOpenAIApiBase(provider.apiBase) || (!provider.apiBase?.trim() && provider.type === LLMProviderType.OPENAI)
    ? 'max_completion_tokens'
    : 'max_tokens';
}

const CHAT_COMPLETIONS_PATH = '/chat/completions';

/**
 * Resolve the OpenAI API surface for a model (ADR-0039). `auto` routes
 * by endpoint: on OpenAI's own API the Responses wire is the default —
 * gpt-6-family models reject function tools on chat completions even
 * with reasoning_effort omitted (the model reasons by default; the wire
 * demands an explicit choice), and /responses keeps reasoning + tools
 * working for every family without per-model configuration. Everywhere
 * else (and for `completions` overrides) it's the legacy wire.
 * Constructing responses is always store-less (zdrEnabled).
 */
export function resolveChatTransport(
  provider: Pick<LLMProvider, 'type' | 'apiBase'>,
  override: string | undefined
): 'completions' | 'responses' {
  if (override === 'completions') {
    return 'completions';
  }
  const openaiWire =
    isOpenAIApiBase(provider.apiBase) ||
    (!provider.apiBase?.trim() && provider.type === LLMProviderType.OPENAI);
  return openaiWire ? 'responses' : 'completions';
}

/**
 * Normalize the token-cap parameter on the serialized request body.
 *
 * `@langchain/openai` picks `max_tokens` vs `max_completion_tokens` from a
 * model-id regex that misroutes prefixed and brand-new ids, and it offers
 * no field to force the wire name (`maxCompletionTokens` is a plain alias).
 * The wrapper is the seam that survives every SDK path: `configuration`
 * rides in the constructor fields, so instances rebuilt by `withConfig()`
 * (bindTools/structured output) keep it, and it rewrites the exact JSON
 * the OpenAI client is about to send — whichever key the SDK chose, the
 * cap moves to the endpoint's parameter ('none' strips the cap entirely).
 */
export function wireTokenParamFetch(
  baseFetch: typeof fetch,
  mode: MaxTokensParamMode
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes(CHAT_COMPLETIONS_PATH) && init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const cap = body.max_tokens ?? body.max_completion_tokens;
        if (cap !== undefined) {
          delete body.max_tokens;
          delete body.max_completion_tokens;
          if (mode !== 'none') {
            body[mode] = cap;
          }
          return baseFetch(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // Not our payload shape — hand it through untouched.
      }
    }
    return baseFetch(input, init);
  };
}


function buildChatOpenAI(provider: LLMProvider, modelId: string, apiKey: string, overrides?: ModelOverrides): ChatOpenAI {
  const temperature = overrides?.temperature ?? provider.temperature;
  const maxTokens = overrides?.maxTokens ?? provider.maxTokens;
  const temperatureLocked = OPENAI_TEMPERATURE_LOCKED_PATTERN.test(bareModelId(modelId));
  // ADR-0039: responses is honored only on the OpenAI endpoint and is
  // always constructed store-less (zdrEnabled → store: false) — the API
  // stores outputs by default and the storage posture here is "never".
  const useResponsesApi = resolveChatTransport(provider, overrides?.chatTransport) === 'responses';
  return new ChatOpenAI({
    apiKey: apiKey || 'local-server',
    model: modelId,
    ...(temperature !== undefined && !temperatureLocked ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(overrides?.reasoningEffort
      ? { reasoning: { effort: overrides.reasoningEffort as unknown as 'low' | 'medium' | 'high' } }
      : {}),
    ...(useResponsesApi ? { useResponsesApi: true, zdrEnabled: true as const } : {}),
    configuration: {
      baseURL: provider.apiBase,
      // ADR-0038: route the token cap to the endpoint's wire parameter.
      fetch: wireTokenParamFetch(globalThis.fetch.bind(globalThis), resolveMaxTokensParam(provider)),
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
