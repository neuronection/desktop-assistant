import { describe, expect, it } from 'vitest';
import { extractUsage } from '@main/ai/usage';

describe('extractUsage', () => {
  it('reads LangChain usage_metadata', () => {
    expect(extractUsage({ usage_metadata: { input_tokens: 10, output_tokens: 5 } })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('reads provider response_metadata tokenUsage', () => {
    expect(extractUsage({ response_metadata: { tokenUsage: { promptTokens: 7, completionTokens: 3 } } })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
  });

  it('reads a callback output generation message', () => {
    expect(
      extractUsage({ generations: [[{ message: { usage_metadata: { input_tokens: 4, output_tokens: 2 } } }]] })
    ).toEqual({ inputTokens: 4, outputTokens: 2 });
  });

  it('reads llmOutput tokenUsage', () => {
    expect(extractUsage({ llmOutput: { tokenUsage: { input_tokens: 9, output_tokens: 1 } } })).toEqual({
      inputTokens: 9,
      outputTokens: 1,
    });
  });

  it('returns null when no usage is present', () => {
    expect(extractUsage({ content: 'hi' })).toBeNull();
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage({ usage_metadata: { input_tokens: -1 } })).toBeNull();
  });
});
