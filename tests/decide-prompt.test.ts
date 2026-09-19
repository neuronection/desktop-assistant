import { describe, it, expect } from 'vitest';
import { DECISION_PROMPT_MAX_CHARS } from '@shared/ai/decisions';
import { assembleDecisionPrompt, DECISION_PROMPT_DEFAULT } from '@main/ai/decide/prompt';

describe('assembleDecisionPrompt', () => {
  it('returns the default prompt for untouched settings', () => {
    expect(assembleDecisionPrompt({ prompt: '', routeTools: [], scope: { apps: [], includeNatives: true } }, [])).toBe(
      DECISION_PROMPT_DEFAULT
    );
  });

  it('appends the user steer, trimmed and capped (D11)', () => {
    const prompt = assembleDecisionPrompt(
      { prompt: `  ${'x'.repeat(DECISION_PROMPT_MAX_CHARS + 50)}  `, routeTools: [], scope: { apps: [], includeNatives: true } },
      []
    );
    expect(prompt.startsWith(`${DECISION_PROMPT_DEFAULT} `)).toBe(true);
    expect(prompt).toHaveLength(DECISION_PROMPT_DEFAULT.length + 1 + DECISION_PROMPT_MAX_CHARS);
  });

  it('adds few-shot lines from route-tool examples (D11)', () => {
    const prompt = assembleDecisionPrompt(
      {
        prompt: '',
        routeTools: [
          {
            name: 'ask_gemini',
            description: 'Route to Gemini.',
            modelId: 'gemini-pro',
            examples: ['hard math question', 'compare two phones'],
          },
        ],
        scope: { apps: [], includeNatives: true },
      },
      []
    );
    expect(prompt).toContain('Example — user says "hard math question" → call ask_gemini.');
    expect(prompt).toContain('Example — user says "compare two phones" → call ask_gemini.');
  });

  it('adds a scope line only when scope narrows the default (D8)', () => {
    const defaults = { prompt: '', routeTools: [], scope: { apps: [], includeNatives: true } };
    expect(assembleDecisionPrompt(defaults, [])).not.toContain('Decision scope');
    expect(
      assembleDecisionPrompt({ ...defaults, scope: { apps: ['homeassistant'], includeNatives: true } }, [])
    ).toContain('Decision scope — integration tools in scope: homeassistant.');
    expect(assembleDecisionPrompt({ ...defaults, scope: { apps: [], includeNatives: false } }, [])).toContain(
      'Decision scope — built-in tools are out of scope.'
    );
  });

  it('falls back to the default prompt when assembly throws (fail-soft)', () => {
    const exploding = {
      get prompt(): string {
        throw new Error('boom');
      },
      routeTools: [],
      scope: { apps: [], includeNatives: true },
    };
    expect(assembleDecisionPrompt(exploding, [])).toBe(DECISION_PROMPT_DEFAULT);
  });
});
