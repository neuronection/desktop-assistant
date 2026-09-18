import { describe, it, expect, vi } from 'vitest';
import {
  TRANSLATION_RESULT_CHAR_CAP,
  buildTranslationMessages,
  normalizeTranslation,
  planEngines,
  translateWithLlm,
} from '@main/ai/translate';
import { AiTask } from '@shared/types';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { LLMProviderType } from '@shared/types';
import type { TranslationProviderConfig } from '@shared/translation';

describe('buildTranslationMessages', () => {
  it('names the target language from the table', () => {
    const [system, user] = buildTranslationMessages('hello', { code: 'el', name: 'Greek' });
    expect(system.content).toContain('Greek (el)');
    expect(system.content).toContain('detecting the source language');
    expect(user).toEqual({ role: 'user', content: 'hello' });
  });

  it('pins a known source language when given', () => {
    const [system] = buildTranslationMessages('hello', { code: 'el', name: 'Greek' }, { code: 'de', name: 'German' });
    expect(system.content).toContain('from German');
    expect(system.content).not.toContain('detecting');
  });

  it('carries custom language labels through', () => {
    const [system] = buildTranslationMessages('hello', { code: 'grc', name: 'Ancient Greek' });
    expect(system.content).toContain('Ancient Greek (grc)');
  });
});

describe('normalizeTranslation', () => {
  it('trims plain output', () => {
    expect(normalizeTranslation('  Hola mundo  ')).toBe('Hola mundo');
  });

  it('strips a wrapping code fence with or without a language tag', () => {
    expect(normalizeTranslation('```\nHola\n```')).toBe('Hola');
    expect(normalizeTranslation('```text\nHola\n```')).toBe('Hola');
    expect(normalizeTranslation('```\nHola\n```\nextra')).toBe('```\nHola\n```\nextra');
  });

  it('strips symmetric wrapping quotes but not asymmetric or inner ones', () => {
    expect(normalizeTranslation('"Hola"')).toBe('Hola');
    expect(normalizeTranslation('“Hola”')).toBe('Hola');
    expect(normalizeTranslation('«Hola»')).toBe('Hola');
    expect(normalizeTranslation('"Hola" said the "guard"')).toBe('"Hola" said the "guard"');
    expect(normalizeTranslation('"Hola')).toBe('"Hola');
  });

  it('caps the output length', () => {
    expect(normalizeTranslation('x'.repeat(TRANSLATION_RESULT_CHAR_CAP + 100)).length).toBe(TRANSLATION_RESULT_CHAR_CAP);
  });
});

describe('translateWithLlm', () => {
  const base = {
    provider: { ...DEFAULT_CONFIG.providers[0], id: 'p1', type: LLMProviderType.OPENAI },
    modelId: 'm1',
    apiKey: 'sk-test',
    text: 'hello',
    target: { code: 'el', name: 'Greek' },
  };

  it('invokes the gateway with the translate task, pinned temperature, and normalizes', async () => {
    const invoke = vi.fn().mockResolvedValue('  ```\n"Καλημέρα"\n```  ');
    const outcome = await translateWithLlm({ invoke }, base);
    expect(invoke).toHaveBeenCalledTimes(1);
    const request = invoke.mock.calls[0][0];
    expect(request.task).toBe(AiTask.TRANSLATE);
    expect(request.modelId).toBe('m1');
    expect(request.apiKey).toBe('sk-test');
    expect(request.overrides).toEqual({ temperature: 0 });
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(outcome).toEqual({ text: 'Καλημέρα', engine: 'llm' });
  });

  it('rejects empty model output', async () => {
    const invoke = vi.fn().mockResolvedValue('   ');
    await expect(translateWithLlm({ invoke }, base)).rejects.toThrow(/empty output/);
  });
});

const provider = (overrides: Partial<TranslationProviderConfig> = {}): TranslationProviderConfig => ({
  id: 'p1',
  name: 'Local LibreTranslate',
  type: 'libretranslate',
  enabled: true,
  ...overrides,
});

describe('planEngines mode matrix', () => {
  it('auto: enabled services first, then llm', () => {
    const plan = planEngines('auto', [provider(), provider({ id: 'p2', name: 'DeepL', type: 'deepl' })], true);
    expect(plan.steps.map((step) => step.kind)).toEqual(['service', 'service', 'llm']);
    expect(plan.errors).toEqual([]);
  });

  it('auto: skips disabled providers', () => {
    const plan = planEngines('auto', [provider({ enabled: false })], true);
    expect(plan.steps.map((step) => step.kind)).toEqual(['llm']);
  });

  it('auto: nothing configured errors naming both inputs', () => {
    const plan = planEngines('auto', [], false);
    expect(plan.steps).toEqual([]);
    expect(plan.errors[0]).toMatch(/not configured/);
    expect(plan.errors[0]).toMatch(/translation service/);
    expect(plan.errors[0]).toMatch(/translation model/);
  });

  it('service: plans only enabled providers, errors when none', () => {
    const plan = planEngines('service', [provider()], false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toEqual({ kind: 'service', provider: provider() });
    expect(planEngines('service', [provider({ enabled: false })], true).errors[0]).toMatch(/No translation service is configured/);
  });

  it('llm: ignores providers, errors when unavailable', () => {
    const plan = planEngines('llm', [provider()], true);
    expect(plan.steps.map((step) => step.kind)).toEqual(['llm']);
    expect(planEngines('llm', [provider()], false).errors[0]).toMatch(/No translation model is assigned/);
    expect(planEngines('llm', [provider()], false).steps).toEqual([]);
  });
});
