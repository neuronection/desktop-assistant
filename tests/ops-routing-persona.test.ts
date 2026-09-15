import { describe, it, expect } from 'vitest';
import { resolveInternalModel, resolveTaskModel } from '@shared/ai/tasks';
import { AiTask } from '@shared/types';
import { buildSystemPrompt } from '@main/ai/graphs/assistant';

const config = (assignments: Record<string, string | null>, defaultChatModelId: string | null = 'chat-model') =>
  ({
    taskAssignments: assignments,
    defaultChatModelId,
    providers: [
      {
        id: 'p1',
        systemPrompt: '',
        availableModels: [
          { id: 'chat-model', name: 'Chat', providerType: 'openai', providerId: 'p1' },
          { id: 'cheap-model', name: 'Cheap', providerType: 'openai', providerId: 'p1' },
        ],
        customModels: [],
      },
    ],
  }) as never;

describe('plumbing routing (plan 12 §7)', () => {
  it('resolveInternalModel prefers the plumbing assignment', () => {
    const resolution = resolveInternalModel(config({ [AiTask.PLUMBING]: 'cheap-model' }));
    expect(resolution?.modelId).toBe('cheap-model');
    expect(resolution?.task).toBe(AiTask.PLUMBING);
  });

  it('falls back to the chat model when plumbing is unset', () => {
    const resolution = resolveInternalModel(config({}));
    expect(resolution?.modelId).toBe('chat-model');
    expect(resolution?.task).toBe(AiTask.CHAT);
  });

  it('still returns null when neither plumbing nor chat exists', () => {
    expect(resolveInternalModel(config({}, null))).toBeNull();
  });

  it('titles can ride plumbing when titles is unassigned', () => {
    const resolution = resolveTaskModel(config({ [AiTask.PLUMBING]: 'cheap-model' }), AiTask.TITLES, null) ?? resolveTaskModel(config({ [AiTask.PLUMBING]: 'cheap-model' }), AiTask.PLUMBING, null);
    expect(resolution?.modelId).toBe('cheap-model');
  });
});

describe('per-conversation personas (plan 12 §7)', () => {
  it('composes the persona after the provider prompt and agent guidance', () => {
    const prompt = buildSystemPrompt('You are helpful.', ['web_fetch'], [], 'You are a terse senior reviewer.');
    expect(prompt).toContain('You are helpful.');
    expect(prompt).toContain('Conversation persona');
    expect(prompt).toContain('You are a terse senior reviewer.');
    expect(prompt.indexOf('You are helpful.')).toBeLessThan(prompt.indexOf('You are a terse senior reviewer.'));
    expect(prompt.indexOf('AGENT')).toBeLessThan(prompt.indexOf('Conversation persona'));
  });

  it('leaves the prompt unchanged without a persona', () => {
    const base = buildSystemPrompt('You are helpful.', [], []);
    const withEmpty = buildSystemPrompt('You are helpful.', [], [], '   ');
    expect(base).toBe(withEmpty);
    expect(base).not.toContain('Conversation persona');
  });

  it('keeps the plain-turn system prompt free of personas for the launcher', () => {
    const prompt = buildSystemPrompt('Global prompt', [], []);
    expect(prompt).toContain('Global prompt');
    expect(prompt).not.toContain('this conversation only');
  });
});
