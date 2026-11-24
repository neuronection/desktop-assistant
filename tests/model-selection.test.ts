import { describe, it, expect } from 'vitest';
import { AiTask, AppConfig, LLMProvider, LLMProviderType, Model } from '@shared/types';
import { DEFAULT_CONFIG, mergeWithDefaults } from '@shared/config/AppConfig';
import {
  findModel,
  modelSelectionKey,
  parseModelSelection,
  resolveTaskModel,
  uniqueModelSelectionKey,
} from '@shared/ai/tasks';

const model = (id: string, providerId: string, overrides: Partial<Model> = {}): Model => ({
  id,
  name: id,
  providerType: LLMProviderType.OPENAI,
  providerId,
  caps: ['text'],
  ...overrides,
});

const provider = (id: string, models: Model[], overrides: Partial<LLMProvider> = {}): LLMProvider => ({
  id,
  name: id,
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'https://api.example.com/v1',
  timeout: 1000,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: models,
  customModels: [],
  ...overrides,
});

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({ ...DEFAULT_CONFIG, ...overrides });

const sharedModelId = 'qwen3:8b';

const sharedProviders = (): LLMProvider[] => [
  provider('first', [model(sharedModelId, 'first')]),
  provider('second', [model(sharedModelId, 'second')]),
];

describe('findModel provider identity (PR #22)', () => {
  it('prefers the default provider when a bare id exists on several providers', () => {
    const cfg = config({ providers: sharedProviders(), defaultProviderId: 'second' });
    expect(findModel(cfg, sharedModelId)).toMatchObject({
      provider: { id: 'second' },
      model: { id: sharedModelId },
    });
  });

  it('falls back to the first provider when no default provider exposes the id', () => {
    const cfg = config({ providers: sharedProviders(), defaultProviderId: 'third' });
    expect(findModel(cfg, sharedModelId)?.provider.id).toBe('first');
    expect(findModel({ providers: cfg.providers }, sharedModelId)?.provider.id).toBe('first');
  });

  it('resolves a qualified selection to its own provider even when another lists the id first', () => {
    const cfg = config({ providers: sharedProviders(), defaultProviderId: 'first' });
    expect(findModel(cfg, modelSelectionKey('second', sharedModelId))?.provider.id).toBe('second');
  });

  it('fails closed on a qualified selection the catalog no longer holds', () => {
    const cfg = config({ providers: sharedProviders(), defaultProviderId: 'first' });
    expect(findModel(cfg, modelSelectionKey('removed-provider', sharedModelId))).toBeNull();
    expect(findModel(cfg, modelSelectionKey('first', 'ghost-model'))).toBeNull();
  });

  it('resolves a unique bare id and ignores unknown ids', () => {
    const cfg = config({
      providers: [provider('only', [model('solo-model', 'only')])],
      defaultProviderId: 'only',
    });
    expect(findModel(cfg, 'solo-model')?.provider.id).toBe('only');
    expect(findModel(cfg, 'ghost-model')).toBeNull();
  });

  it('rejects a qualified decision model for chat', () => {
    const cfg = config({
      providers: [
        provider('decision-provider', [
          model('jev-1.13', 'decision-provider', { caps: ['decision'], decisionTransport: 'systemone' }),
        ]),
      ],
      taskAssignments: {
        ...DEFAULT_CONFIG.taskAssignments,
        [AiTask.CHAT]: modelSelectionKey('decision-provider', 'jev-1.13'),
      },
    });
    expect(findModel(cfg, cfg.taskAssignments[AiTask.CHAT] as string)).not.toBeNull();
    expect(resolveTaskModel(cfg, AiTask.CHAT)).toBeNull();
  });
});

describe('uniqueModelSelectionKey', () => {
  it('qualifies only a bare id that exactly one provider exposes', () => {
    const unique = config({ providers: [provider('only', [model('solo-model', 'only')])] });
    expect(uniqueModelSelectionKey(unique, 'solo-model')).toBe(modelSelectionKey('only', 'solo-model'));

    const ambiguous = config({ providers: sharedProviders() });
    expect(uniqueModelSelectionKey(ambiguous, sharedModelId)).toBeNull();
    expect(uniqueModelSelectionKey(ambiguous, 'ghost-model')).toBeNull();
    expect(uniqueModelSelectionKey(ambiguous, modelSelectionKey('first', sharedModelId))).toBeNull();
  });

  it('does not qualify a decision model, so a text slot keeps its fall-through', () => {
    const providers = [
      provider('decision-provider', [
        model('jev-1.13', 'decision-provider', { caps: ['decision'], decisionTransport: 'systemone' }),
      ]),
      provider('text-provider', [model('chat-1', 'text-provider')]),
    ];
    const ctx = config({ providers });
    expect(uniqueModelSelectionKey(ctx, 'jev-1.13')).toBeNull();

    const merged = mergeWithDefaults({
      providers,
      defaultChatModelId: 'chat-1',
      taskAssignments: { [AiTask.CHAT]: 'jev-1.13' },
    });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe('jev-1.13');
    expect(resolveTaskModel(merged, AiTask.CHAT)).toMatchObject({ providerId: 'text-provider', modelId: 'chat-1' });
  });
});

describe('mergeWithDefaults assignment qualification (PR #22)', () => {
  it('qualifies legacy bare assignments on load when unambiguous', () => {
    const providers = [provider('p1', [model('chat-1', 'p1')]), provider('p2', [model('titles-1', 'p2')])];
    const merged = mergeWithDefaults({
      providers,
      taskAssignments: { [AiTask.CHAT]: 'chat-1', [AiTask.TITLES]: 'titles-1' },
    });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe(modelSelectionKey('p1', 'chat-1'));
    expect(merged.taskAssignments[AiTask.TITLES]).toBe(modelSelectionKey('p2', 'titles-1'));
    expect(parseModelSelection(merged.taskAssignments[AiTask.CHAT] as string)).toEqual({
      providerId: 'p1',
      modelId: 'chat-1',
    });
  });

  it('leaves an ambiguous bare assignment bare and resolves it through the default provider', () => {
    const merged = mergeWithDefaults({
      providers: sharedProviders(),
      defaultProviderId: 'second',
      taskAssignments: { [AiTask.CHAT]: sharedModelId },
    });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe(sharedModelId);
    expect(resolveTaskModel(merged, AiTask.CHAT)).toMatchObject({ providerId: 'second', modelId: sharedModelId });
  });

  it('never qualifies decision slots or fallback assignments', () => {
    const providers = [
      provider('decision-provider', [
        model('jev-1.13', 'decision-provider', { caps: ['decision'], decisionTransport: 'systemone' }),
      ]),
    ];
    const merged = mergeWithDefaults({
      providers,
      taskAssignments: {
        [AiTask.CHAT]: null,
        decision: 'jev-1.13',
        'decision:tool-dispatch': 'jev-1.13',
      },
      taskFallbackAssignments: { 'decision:tool-dispatch': 'jev-1.13' },
    });
    expect(merged.taskAssignments.decision).toBe('jev-1.13');
    expect(merged.taskAssignments['decision:tool-dispatch']).toBe('jev-1.13');
    expect(merged.taskFallbackAssignments['decision:tool-dispatch']).toBe('jev-1.13');
  });

  it('is idempotent', () => {
    const once = mergeWithDefaults({
      providers: [
        provider('p1', [model('chat-1', 'p1')]),
        provider('p2', [model(sharedModelId, 'p2')]),
        provider('p3', [model(sharedModelId, 'p3')]),
      ],
      taskAssignments: { [AiTask.CHAT]: 'chat-1', [AiTask.TITLES]: sharedModelId },
    });
    const twice = mergeWithDefaults(once);
    expect(twice.taskAssignments).toEqual(once.taskAssignments);
    expect(twice.taskAssignments[AiTask.CHAT]).toBe(modelSelectionKey('p1', 'chat-1'));
  });

  it('keeps unresolvable and malformed values as written', () => {
    const malformed = 'provider-model:not-json';
    const merged = mergeWithDefaults({
      providers: [provider('p1', [model('chat-1', 'p1')])],
      taskAssignments: {
        [AiTask.CHAT]: 'ghost-model',
        [AiTask.TITLES]: malformed,
        [AiTask.TRANSLATE]: '   spaced-model   ',
      },
    });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe('ghost-model');
    expect(merged.taskAssignments[AiTask.TITLES]).toBe(malformed);
    expect(merged.taskAssignments[AiTask.TRANSLATE]).toBe('spaced-model');
    expect(() => mergeWithDefaults({ providers: [null as never] })).not.toThrow();
    expect(() => mergeWithDefaults({ providers: 'garbage' as never })).not.toThrow();
  });

  it('does not revive a stale default chat model through qualification', () => {
    const providers = [provider('p1', [model('chat-1', 'p1')])];
    const merged = mergeWithDefaults({
      providers,
      defaultChatModelId: 'stale-model',
      taskAssignments: { [AiTask.CHAT]: null, [AiTask.TITLES]: null },
    });
    expect(merged.defaultChatModelId).toBe('stale-model');
    expect(merged.taskAssignments[AiTask.CHAT]).toBe('stale-model');
    expect(parseModelSelection(merged.taskAssignments[AiTask.CHAT] as string)).toBeNull();
    expect(merged.taskAssignments[AiTask.TITLES]).toBeNull();
    expect(resolveTaskModel(merged, AiTask.TITLES)).toBeNull();
  });
});
