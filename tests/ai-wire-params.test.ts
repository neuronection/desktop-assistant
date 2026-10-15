import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { ChatOpenAI } = vi.hoisted(() => ({ ChatOpenAI: vi.fn() }));
vi.mock('@langchain/openai', () => ({ ChatOpenAI }));

import { createChatModel, isOpenAIApiBase, resolveChatTransport, resolveMaxTokensParam } from '@main/ai/chat-models';
import { LLMProvider, LLMProviderType } from '@shared/types';

/**
 * Shared wire-parameter fixture wall (ADR-0038) — desktop's side. The
 * fixture table is vendored byte-identical from dev/contracts/ (synced by
 * sync-wire-params.sh); the Python factories run the same rows through the
 * vendored wire_params module. A row change is a contract change.
 */
const FIXTURES = JSON.parse(
  readFileSync(new URL('./fixtures/wire-params.fixtures.json', import.meta.url), 'utf8')
) as {
  endpointDetection: Array<{ name: string; apiBase: string | null; expected: boolean }>;
  maxTokensParam: Array<{ name: string; providerType: string; apiBase: string | null; override: string | null; expected: string }>;
  temperatureOmission: Array<{ name: string; temperature: number | null; sent: boolean }>;
  chatTransport: Array<{ name: string; providerType: string; apiBase: string | null; override: string | null; expected: string }>;
  temperatureModelId: string;
};

const provider = (overrides: Partial<LLMProvider> = {}): LLMProvider =>
  ({
    id: 'p1',
    name: 'Provider',
    type: LLMProviderType.OPENAI,
    apiKey: '',
    apiBase: '',
    timeout: 1000,
    maxTokens: 1000,
    systemPrompt: '',
    availableModels: [],
    customModels: [],
    ...overrides,
  }) as LLMProvider;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wire-params fixture wall (endpoint detection)', () => {
  it.each(FIXTURES.endpointDetection)('%s', ({ apiBase, expected }) => {
    expect(isOpenAIApiBase(apiBase ?? undefined)).toBe(expected);
  });
});

describe('wire-params fixture wall (token-cap parameter resolution)', () => {
  it.each(FIXTURES.maxTokensParam)('%s', ({ providerType, apiBase, override, expected }) => {
    const resolved = resolveMaxTokensParam({
      type: providerType as LLMProvider['type'],
      apiBase: apiBase ?? '',
      maxTokensParam: (override ?? 'auto') as LLMProvider['maxTokensParam'],
    });
    expect(resolved).toBe(expected);
  });
});

describe('wire-params fixture wall (temperature omit-unless-configured)', () => {
  it.each(FIXTURES.temperatureOmission)('%s', ({ temperature, sent }) => {
    createChatModel(
      provider(temperature === null ? {} : { temperature }),
      FIXTURES.temperatureModelId,
      'sk-test'
    );
    const args = ChatOpenAI.mock.calls[0][0];
    expect(args.temperature).toBe(sent ? temperature : undefined);
  });
});

describe('wire-params fixture wall (chat transport, ADR-0039)', () => {
  it.each(FIXTURES.chatTransport)('%s', ({ providerType, apiBase, override, expected }) => {
    expect(
      resolveChatTransport(
        { type: providerType as LLMProvider['type'], apiBase: apiBase ?? '' },
        override ?? undefined
      )
    ).toBe(expected);
  });

  it('constructs the responses path store-less when a row opts in', () => {
    createChatModel(
      provider({ apiBase: 'https://api.openai.com/v1' }),
      'gpt-6-luna',
      'sk-test',
      { chatTransport: 'responses', reasoningEffort: 'high' }
    );
    const args = ChatOpenAI.mock.calls[0][0];
    expect(args.useResponsesApi).toBe(true);
    expect(args.zdrEnabled).toBe(true);
    expect(args.reasoning).toEqual({ effort: 'high' });
    // The completions body normalizer must not touch the responses wire.
    expect(typeof args.configuration.fetch).toBe('function');
  });

  it('keeps auto and completions rows on the completions wire', () => {
    const p = provider({ apiBase: 'https://api.openai.com/v1' });
    createChatModel(p, 'gpt-6-luna', 'sk-test');
    expect(ChatOpenAI.mock.calls[0][0].useResponsesApi).toBeUndefined();
    createChatModel(p, 'gpt-6-luna', 'sk-test', { chatTransport: 'completions', reasoningEffort: 'high' });
    expect(ChatOpenAI.mock.calls[1][0].useResponsesApi).toBeUndefined();
  });
});
