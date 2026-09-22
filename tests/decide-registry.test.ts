import { describe, it, expect } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { DECISION_ENGINE_KINDS } from '@shared/ai/decisions';
import {
  decisionEngineCapabilities,
  decisionEngineDisplayName,
  engineReadiness,
  getDecisionEngineRegistration,
} from '@main/ai/decide';

const provider: LLMProvider = {
  id: 'provider-1',
  name: 'Test Provider',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [],
  customModels: [],
};

describe('decision engine registry', () => {
  it('registers every runtime kind with capabilities and a display name', () => {
    for (const kind of DECISION_ENGINE_KINDS) {
      const registration = getDecisionEngineRegistration(kind);
      expect(registration.kind).toBe(kind);
      expect(registration.capabilities.size).toBeGreaterThan(0);
      expect(registration.capabilities.has('tool-dispatch')).toBe(true);
      expect(decisionEngineDisplayName(kind)).toBeTruthy();
      expect(decisionEngineCapabilities(kind)).toBe(registration.capabilities);
    }
  });

  it('maps resolutions to the generic readiness surface (D7)', () => {
    expect(engineReadiness({ kind: 'off' })).toMatchObject({ state: 'unavailable' });
    expect(engineReadiness({ kind: 'unconfigured', reason: 'x' })).toMatchObject({ state: 'unavailable' });
    expect(engineReadiness({ kind: 'unavailable', reason: 'x' })).toMatchObject({ state: 'unavailable' });
    expect(engineReadiness({ kind: 'llm-engine', provider, modelId: 'm' })).toEqual({ state: 'ready' });
    expect(
      engineReadiness({ kind: 'needle-engine', weightsPath: '/w', resourceDir: '/r' })
    ).toEqual({ state: 'ready' });
  });
});
