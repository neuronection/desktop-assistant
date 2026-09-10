import { describe, it, expect } from 'vitest';
import { AiTask, LLMProviderType } from '@shared/types';
import { AppConfig, DEFAULT_CONFIG, mergeWithDefaults } from '@shared/config/AppConfig';
import { hasCap, inferModelCaps, modelTuning, resolveTaskModel } from '@shared/ai/tasks';

const provider = (overrides: Partial<AppConfig['providers'][number]> = {}): AppConfig['providers'][number] => ({
  id: 'p1',
  name: 'Provider One',
  type: LLMProviderType.OPENAI,
  apiKey: '',
  apiBase: 'http://localhost:11434/v1',
  timeout: 1000,
  temperature: 0.5,
  maxTokens: 1000,
  systemPrompt: '',
  availableModels: [],
  customModels: [],
  ...overrides,
});

const config = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...DEFAULT_CONFIG,
  providers: [provider()],
  ...overrides,
});

describe('resolveTaskModel', () => {
  it('prefers the explicit model over the task assignment', () => {
    const cfg = config({
      taskAssignments: { [AiTask.CHAT]: 'm-chat', [AiTask.TITLES]: null },
      providers: [provider({ availableModels: [{ id: 'm-explicit', name: 'Explicit', providerType: LLMProviderType.OPENAI, providerId: 'p1' }, { id: 'm-chat', name: 'Chat', providerType: LLMProviderType.OPENAI, providerId: 'p1' }] })],
    });
    const resolution = resolveTaskModel(cfg, AiTask.CHAT, 'm-explicit');
    expect(resolution?.modelId).toBe('m-explicit');
    expect(resolution?.provider.id).toBe('p1');
  });

  it('falls back to the task assignment, then the legacy default chat model', () => {
    const cfg = config({
      defaultChatModelId: 'm-legacy',
      providers: [provider({ availableModels: [{ id: 'm-legacy', name: 'Legacy', providerType: LLMProviderType.OPENAI, providerId: 'p1' }] })],
    });
    expect(resolveTaskModel(cfg, AiTask.CHAT, null)?.modelId).toBe('m-legacy');

    const withAssignment = config({
      taskAssignments: { [AiTask.CHAT]: 'm-current', [AiTask.TITLES]: null },
      defaultChatModelId: 'm-legacy',
      providers: [provider({ availableModels: [{ id: 'm-current', name: 'Current', providerType: LLMProviderType.OPENAI, providerId: 'p1' }, { id: 'm-legacy', name: 'Legacy', providerType: LLMProviderType.OPENAI, providerId: 'p1' }] })],
    });
    expect(resolveTaskModel(withAssignment, AiTask.CHAT, null)?.modelId).toBe('m-current');
  });

  it('returns null when nothing resolves and skips unknown model ids', () => {
    expect(resolveTaskModel(config(), AiTask.CHAT, 'ghost')).toBeNull();
    expect(resolveTaskModel(config(), AiTask.TITLES, null)).toBeNull();
    const dangling = config({ taskAssignments: { [AiTask.CHAT]: 'ghost', [AiTask.TITLES]: null } });
    expect(resolveTaskModel(dangling, AiTask.CHAT, null)).toBeNull();
  });
});

describe('hasCap', () => {
  it('treats cap-less legacy models as unrestricted and honours explicit caps', () => {
    const legacy = { id: 'm1', name: 'm1', providerType: LLMProviderType.OPENAI, providerId: 'p1' };
    expect(hasCap(legacy, 'tools')).toBe(true);
    const restricted = { ...legacy, caps: ['text' as const] };
    expect(hasCap(restricted, 'tools')).toBe(false);
    expect(hasCap(restricted, 'text')).toBe(true);
  });
});

describe('inferModelCaps', () => {
  it('infers embeddings, audio and vision from the model id', () => {
    expect(inferModelCaps('text-embedding-3-large')).toEqual(['embeddings']);
    expect(inferModelCaps('whisper-1')).toEqual(['audio']);
    expect(inferModelCaps('gpt-4o-mini')).toEqual(['text', 'tools', 'vision']);
    expect(inferModelCaps('llama3:8b')).toEqual(['text', 'tools']);
  });
});

describe('modelTuning', () => {
  it('lets the model override provider tuning', () => {
    const p = provider();
    const model = { id: 'm1', name: 'm1', providerType: LLMProviderType.OPENAI, providerId: 'p1', temperature: 0.2, maxTokens: 512 };
    expect(modelTuning(p, model)).toEqual({ temperature: 0.2, maxTokens: 512 });
  });

  it('suppresses temperature for reasoning models unless explicitly set', () => {
    const p = provider();
    const reasoning = { id: 'o4', name: 'o4', providerType: LLMProviderType.OPENAI, providerId: 'p1', reasoningEffort: 'high' };
    expect(modelTuning(p, reasoning)).toEqual({ reasoningEffort: 'high', maxTokens: 1000 });
    const explicit = { ...reasoning, temperature: 0.1 };
    expect(modelTuning(p, explicit)).toEqual({ reasoningEffort: 'high', temperature: 0.1, maxTokens: 1000 });
  });

  it('passes reasoning_effort none through while keeping temperature', () => {
    const p = provider();
    const noReasoning = { id: 'm-luna', name: 'luna', providerType: LLMProviderType.OPENAI, providerId: 'p1', reasoningEffort: 'none' };
    expect(modelTuning(p, noReasoning)).toEqual({ reasoningEffort: 'none', temperature: 0.5, maxTokens: 1000 });
  });
});

describe('mergeWithDefaults ai-settings migration', () => {
  it('seeds the chat task from the legacy default chat model', () => {
    const merged = mergeWithDefaults({ defaultChatModelId: 'm-legacy' });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe('m-legacy');
    expect(merged.taskAssignments[AiTask.TITLES]).toBeNull();
  });

  it('keeps explicit assignments over the legacy fallback', () => {
    const merged = mergeWithDefaults({
      defaultChatModelId: 'm-legacy',
      taskAssignments: { [AiTask.CHAT]: 'm-current', [AiTask.TITLES]: 'm-legacy' },
    });
    expect(merged.taskAssignments[AiTask.CHAT]).toBe('m-current');
    expect(merged.taskAssignments[AiTask.TITLES]).toBe('m-legacy');
  });

  it('folds customModels into the provider registry', () => {
    const merged = mergeWithDefaults({
      providers: [
        provider({
          availableModels: [{ id: 'm1', name: 'One', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
          customModels: [{ id: 'm1', name: 'Dup', providerType: LLMProviderType.OPENAI, providerId: 'p1' }, { id: 'm2', name: 'Two', providerType: LLMProviderType.OPENAI, providerId: 'p1' }],
        }),
      ],
    });
    expect(merged.providers[0].availableModels.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(merged.providers[0].customModels).toEqual([]);
  });
});
