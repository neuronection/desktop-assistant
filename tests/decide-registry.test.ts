import { describe, it, expect } from 'vitest';
import { DECISION_TRANSPORTS, decisionSlot, type DecisionCapability } from '@shared/ai/decisions';
import {
  clearDecisionResolutionCache,
  decisionTransportCapabilities,
  decisionTransportDisplayName,
  engineReadiness,
  getDecisionTransportRegistration,
  resolveDecision,
} from '@main/ai/decide';
import { mergeWithDefaults, type AppConfig } from '@shared/config/AppConfig';
import type { LLMProvider } from '@shared/types';
import { LLMProviderType } from '@shared/types';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [
    {
      id: 'jev-latest',
      name: 'Jev',
      providerType: LLMProviderType.OPENAI,
      providerId: 'provider-1',
      caps: ['decision'],
      decisionTransport: 'systemone',
    },
  ],
  customModels: [],
};

describe('decision transport registry (plan 26 D6/D2b)', () => {
  it('registers exactly one transport today: systemone', () => {
    expect([...DECISION_TRANSPORTS]).toEqual(['systemone']);
    for (const transport of DECISION_TRANSPORTS) {
      expect(getDecisionTransportRegistration(transport).transport).toBe(transport);
    }
  });

  it('systemone declares the four assignable capabilities and not open-args', () => {
    const caps = decisionTransportCapabilities('systemone');
    for (const capability of ['tool-dispatch', 'boolean-gate', 'choice', 'score'] as DecisionCapability[]) {
      expect(caps.has(capability)).toBe(true);
    }
    expect(caps.has('open-args')).toBe(false);
  });

  it('exposes a display name for every transport', () => {
    expect(decisionTransportDisplayName('systemone')).toBeTruthy();
  });

  it('audit meta carries providerId and the assigned model id (D10)', async () => {
    clearDecisionResolutionCache();
    const config: AppConfig = mergeWithDefaults({
      providers: [provider],
      defaultProviderId: provider.id,
      taskAssignments: { [decisionSlot('tool-dispatch')]: 'jev-latest' } as never,
    });
    const resolution = await resolveDecision('tool-dispatch', config, { getApiKey: async () => 'key' });
    expect(getDecisionTransportRegistration('systemone').audit(resolution)).toEqual({
      providerId: 'provider-1',
      model: 'jev-latest',
    });
  });

  it('engineReadiness maps off, needs-key and unavailable (plan 24 D7)', () => {
    expect(engineReadiness({ kind: 'systemone', apiKey: 'k', baseUrl: 'https://x', provider, model: provider.availableModels[0] })).toEqual({ state: 'ready' });
    expect(engineReadiness({ kind: 'off' })).toMatchObject({ state: 'unavailable' });
    expect(
      engineReadiness({ kind: 'unavailable', reason: 'No API key is set for the decision provider.', code: 'needs-key', providerId: 'p1' })
    ).toEqual({ state: 'needs-key', secretId: 'provider:p1' });
    expect(engineReadiness({ kind: 'unconfigured', reason: 'nope' })).toEqual({ state: 'unavailable', reason: 'nope' });
  });
});
