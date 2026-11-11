import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { createAiCallPriceResolver } from '@main/ai/pricing';
import type { AiCallRecord } from '@main/ai/audit';

function provider(overrides: Partial<LLMProvider>): LLMProvider {
  return {
    id: 'p1',
    name: 'OpenAI',
    type: LLMProviderType.OPENAI,
    apiKey: '',
    apiBase: 'https://api.openai.com/v1',
    timeout: 30_000,
    maxTokens: 1024,
    systemPrompt: '',
    presetKey: 'openai',
    availableModels: [],
    ...overrides,
  } as LLMProvider;
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    providers: [provider({})],
    ...overrides,
  } as AppConfig;
}

const record: AiCallRecord = {
  task: 'chat',
  providerId: 'p1',
  model: 'gpt-6.1-sol',
  durationMs: 10,
  outcome: 'ok',
  inputTokens: 1_000,
  outputTokens: 500,
};

describe('createAiCallPriceResolver', () => {
  it('records a user override with provenance at call time', () => {
    const resolver = createAiCallPriceResolver(() =>
      config({
        usage: {
          pricing: [
            {
              provider: 'openai',
              model: 'gpt-6.1-sol',
              inputMicrosPerMillion: 1_000_000,
              outputMicrosPerMillion: 2_000_000,
            },
          ],
        },
      })
    );
    expect(resolver(record)).toMatchObject({
      costMicros: 2_000,
      usageSource: 'provider',
      priceSource: 'user',
    });
    expect(resolver(record).priceVersion).toMatch(/^model-pricing\/1:2026-11-11:/);
  });

  it('marks a loopback call local and zero', () => {
    const resolver = createAiCallPriceResolver(() =>
      config({ providers: [provider({ apiBase: 'http://localhost:11434/v1', presetKey: undefined })] })
    );
    expect(resolver(record)).toMatchObject({
      costMicros: 0,
      usageSource: 'provider',
      priceSource: 'local',
    });
  });

  it('leaves non-token writers unpriced', () => {
    const resolver = createAiCallPriceResolver(() => config());
    expect(resolver({ ...record, task: 'translate' })).toMatchObject({
      costMicros: null,
      usageSource: 'unknown',
      priceSource: 'unknown',
    });
  });

  it('keeps a partial provider report partial, not estimated', () => {
    const resolver = createAiCallPriceResolver(() =>
      config({ usage: { pricing: [{ model: 'gpt-6.1-sol', inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000 }] } })
    );
    expect(resolver({ ...record, outputTokens: undefined })).toMatchObject({
      costMicros: null,
      usageSource: 'partial',
      priceSource: 'user',
    });
  });
});
