import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ChatOpenAI, ChatAnthropic, ChatGoogle } = vi.hoisted(() => ({
  ChatOpenAI: vi.fn(),
  ChatAnthropic: vi.fn(),
  ChatGoogle: vi.fn(),
}));

vi.mock('@langchain/openai', () => ({ ChatOpenAI }));
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic }));
vi.mock('@langchain/google', () => ({ ChatGoogle }));

import { createAgentModel, createChatModel, createStructuredChatModel, isOpenAIApiBase, resolveMaxTokensParam, wireTokenParamFetch } from '@main/ai/chat-models';
import { z } from 'zod';
import { LLMProvider, LLMProviderType } from '@shared/types';

const provider = (type: LLMProvider['type'], apiBase: string): LLMProvider => ({
  id: 'p1',
  name: 'Test',
  type,
  apiKey: '',
  apiBase,
  temperature: 0.5,
  maxTokens: 1000,
} as LLMProvider);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('chat-models factory branches', () => {
  it('routes openai-compatible providers through ChatOpenAI with the base URL', () => {
    createChatModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-4o', 'sk-test');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', apiKey: 'sk-test', configuration: expect.objectContaining({ baseURL: 'https://api.openai.com/v1' }) })
    );
  });

  it('routes ollama through ChatOpenAI with a placeholder key', () => {
    createChatModel(provider('ollama', 'http://localhost:11434/v1'), 'llama3', '');
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'local-server', model: 'llama3' })
    );
  });

  it('applies per-model overrides including reasoning effort on the OpenAI branch', () => {
    createAgentModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-4o', 'sk-test', {
      temperature: 0.1,
      maxTokens: 512,
      reasoningEffort: 'high',
    });
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1, maxTokens: 512, reasoning: { effort: 'high' } })
    );
  });

  it('omits temperature for OpenAI reasoning models that lock it to the default', () => {
    createAgentModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-5.4', 'sk-test', { temperature: 0 });
    const locked = ChatOpenAI.mock.calls[0][0];
    expect(locked.temperature).toBeUndefined();
    createChatModel(provider('openai', 'https://api.openai.com/v1'), 'o4-mini', 'sk-test');
    const oSeries = ChatOpenAI.mock.calls[1][0];
    expect(oSeries.temperature).toBeUndefined();
    expect(oSeries.model).toBe('o4-mini');
  });

  it('keeps the provider temperature for models that support it', () => {
    createChatModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-4o', 'sk-test');
    expect(ChatOpenAI.mock.calls[0][0].temperature).toBe(0.5);
  });

  it('passes reasoning_effort none through for tool-calling gateways that require it', () => {
    createChatModel(provider('openai', 'https://gateway.local/v1'), 'gpt-5.6-luna', 'sk-test', { reasoningEffort: 'none' });
    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: { effort: 'none' } })
    );
  });

  it('routes anthropic through ChatAnthropic and ignores openai reasoning effort', () => {
    createChatModel(provider('anthropic', 'https://api.anthropic.com'), 'claude-sonnet-4-5', 'sk-ant', {
      reasoningEffort: 'high',
      maxTokens: 2048,
    });
    const args = ChatAnthropic.mock.calls[0][0];
    expect(args).toMatchObject({ model: 'claude-sonnet-4-5', apiKey: 'sk-ant', maxTokens: 2048 });
    expect(args.reasoningEffort).toBeUndefined();
    expect(args.anthropicApiUrl).toBeUndefined();
  });

  it('passes a custom anthropic URL only when the provider overrides the default', () => {
    createChatModel(provider('anthropic', 'https://proxy.local'), 'claude-3-haiku', 'k');
    expect(ChatAnthropic.mock.calls[0][0].anthropicApiUrl).toBe('https://proxy.local');
  });

  it('routes google through ChatGoogle mapping maxTokens to maxOutputTokens', () => {
    createChatModel(provider('google', 'https://generativelanguage.googleapis.com/v1beta'), 'gemini-2.0-flash', 'g-key', { maxTokens: 777 });
    expect(ChatGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.0-flash', apiKey: 'g-key', maxOutputTokens: 777 })
    );
  });

  it('binds structured output with a provider-safe pruned schema on the OpenAI branch', () => {
    const decisionSchema = z.object({
      calls: z.array(z.object({ tool: z.string().min(1), args: z.record(z.string(), z.unknown()).default({}) })).default([]),
      confidence: z.number().default(0),
    });
    const withStructuredOutput = vi.fn().mockReturnValue({ invoke: async () => ({}) });
    ChatOpenAI.mockImplementationOnce(function (this: Record<string, unknown>) {
      this.withStructuredOutput = withStructuredOutput;
    });
    createStructuredChatModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-5.4', 'sk-test', decisionSchema);
    expect(withStructuredOutput).toHaveBeenCalledTimes(1);
    const bound = withStructuredOutput.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(bound)).not.toContain('propertyNames');
    expect(JSON.stringify(bound)).not.toContain('additionalProperties');
    expect(bound).toMatchObject({ type: 'object' });
  });

  it('hands the OpenAI wire-normalizing fetch to ChatOpenAI on the OpenAI branch', () => {
    createChatModel(provider('openai', 'https://api.openai.com/v1'), 'gpt-4o', 'sk-test');
    const args = ChatOpenAI.mock.calls[0][0];
    expect(typeof args.configuration.fetch).toBe('function');
  });
});

describe('resolveMaxTokensParam (ADR-0038 endpoint routing)', () => {
  const withBase = (apiBase: string, maxTokensParam?: LLMProvider['maxTokensParam']): LLMProvider =>
    ({ ...provider('openai', apiBase), maxTokensParam }) as LLMProvider;

  it('routes api.openai.com to max_completion_tokens regardless of model id', () => {
    // The ids the SDK regex misroutes: gpt-5-chat variants, prefixed
    // gateway ids, and future families — the endpoint decides, not the id.
    for (const apiBase of ['https://api.openai.com/v1', 'https://api.openai.com']) {
      for (const model of ['gpt-5-chat-latest', 'openai/gpt-5.6-terra', 'gpt-4o']) {
        void model; // model id is intentionally irrelevant to the policy
        expect(resolveMaxTokensParam(withBase(apiBase))).toBe('max_completion_tokens');
      }
    }
  });

  it('routes every other base URL to max_tokens — local servers and proxies alike', () => {
    for (const apiBase of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'https://openrouter.ai/api/v1']) {
      // Even a gpt-5-ish id stays on max_tokens off the OpenAI endpoint.
      expect(resolveMaxTokensParam(withBase(apiBase))).toBe('max_tokens');
    }
  });

  it('treats an empty base URL on an openai-typed provider as the OpenAI default', () => {
    expect(resolveMaxTokensParam(withBase(''))).toBe('max_completion_tokens');
    expect(resolveMaxTokensParam({ ...withBase(''), type: LLMProviderType.OLLAMA })).toBe('max_tokens');
  });

  it('lets an explicit provider override win over endpoint detection', () => {
    expect(resolveMaxTokensParam(withBase('https://api.openai.com/v1', 'max_tokens'))).toBe('max_tokens');
    expect(resolveMaxTokensParam(withBase('http://localhost:11434/v1', 'max_completion_tokens'))).toBe('max_completion_tokens');
    expect(resolveMaxTokensParam(withBase('https://api.openai.com/v1', 'none'))).toBe('none');
    expect(resolveMaxTokensParam(withBase('http://localhost:11434/v1', 'auto'))).toBe('max_tokens');
  });

  it('detects the OpenAI endpoint without tripping on invalid URLs or lookalike hosts', () => {
    expect(isOpenAIApiBase('https://api.openai.com/v1')).toBe(true);
    expect(isOpenAIApiBase(undefined)).toBe(false);
    expect(isOpenAIApiBase('')).toBe(false);
    expect(isOpenAIApiBase('not a url')).toBe(false);
    expect(isOpenAIApiBase('https://api.openai.com.evil.test/v1')).toBe(false);
    expect(isOpenAIApiBase('https://proxy.internal/api.openai.com')).toBe(false);
  });
});

describe('wireTokenParamFetch (wire body normalization)', () => {
  const jsonRequest = (body: unknown): [string, RequestInit] => [
    'https://api.openai.com/v1/chat/completions',
    { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
  ];

  const capturedBody = async (mode: 'max_tokens' | 'max_completion_tokens' | 'none', request: [string, RequestInit]): Promise<Record<string, unknown>> => {
    let seen: RequestInit | undefined;
    const baseFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen = init;
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await wireTokenParamFetch(baseFetch, mode)(...request);
    return JSON.parse(String(seen?.body)) as Record<string, unknown>;
  };

  it('renames whatever cap the SDK chose to the endpoint parameter', async () => {
    // SDK regex sent max_tokens for a misrouted id on api.openai.com.
    const fixed = await capturedBody('max_completion_tokens', jsonRequest({ model: 'gpt-5-chat-latest', max_tokens: 4096 }));
    expect(fixed.max_completion_tokens).toBe(4096);
    expect(fixed.max_tokens).toBeUndefined();
    // Inverse: SDK sent max_completion_tokens for a gpt-5-named local model.
    const local = await capturedBody('max_tokens', jsonRequest({ model: 'gpt-5-local-merge', max_completion_tokens: 512 }));
    expect(local.max_tokens).toBe(512);
    expect(local.max_completion_tokens).toBeUndefined();
  });

  it('strips the cap entirely in none mode and leaves capless payloads alone', async () => {
    const stripped = await capturedBody('none', jsonRequest({ model: 'gpt-4o', max_tokens: 4096 }));
    expect(stripped.max_tokens).toBeUndefined();
    expect(stripped.max_completion_tokens).toBeUndefined();
    const untouched = await capturedBody('max_completion_tokens', jsonRequest({ model: 'gpt-4o' }));
    expect(untouched).toEqual({ model: 'gpt-4o' });
  });

  it('passes non-chat-completions requests and non-string bodies through untouched', async () => {
    const baseFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const wrapped = wireTokenParamFetch(baseFetch, 'none');
    await wrapped('https://api.openai.com/v1/embeddings', { method: 'POST', body: JSON.stringify({ max_tokens: 5 }) });
    await wrapped('https://api.openai.com/v1/chat/completions', { method: 'POST', body: new Uint8Array([1]) });
    await wrapped('https://api.openai.com/v1/models', { method: 'GET' });
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });
});
