import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ChatOpenAI, ChatAnthropic, ChatGoogle } = vi.hoisted(() => ({
  ChatOpenAI: vi.fn(),
  ChatAnthropic: vi.fn(),
  ChatGoogle: vi.fn(),
}));

vi.mock('@langchain/openai', () => ({ ChatOpenAI }));
vi.mock('@langchain/anthropic', () => ({ ChatAnthropic }));
vi.mock('@langchain/google', () => ({ ChatGoogle }));

import { createAgentModel, createChatModel, createStructuredChatModel } from '@main/ai/chat-models';
import { z } from 'zod';
import { LLMProvider } from '@shared/types';

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
      expect.objectContaining({ model: 'gpt-4o', apiKey: 'sk-test', configuration: { baseURL: 'https://api.openai.com/v1' } })
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
});
