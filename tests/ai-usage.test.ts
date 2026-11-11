import { describe, expect, it } from 'vitest';
import { extractUsage, mergeUsage } from '@main/ai/usage';
import { isLocalApiBase } from '@shared/usage';

describe('isLocalApiBase', () => {
  it('recognizes loopback, IPv6 loopback and .local', () => {
    expect(isLocalApiBase('http://localhost:11434/v1')).toBe(true);
    expect(isLocalApiBase('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalApiBase('http://[::1]:11434/v1')).toBe(true);
    expect(isLocalApiBase('http://box.local/v1')).toBe(true);
    expect(isLocalApiBase('https://api.openai.com/v1')).toBe(false);
    expect(isLocalApiBase(undefined)).toBe(false);
  });
});

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

  it('keeps a partial report partial instead of inventing zeroes', () => {
    expect(extractUsage({ usage_metadata: { output_tokens: 200 } })).toEqual({ outputTokens: 200 });
    expect(extractUsage({ usage_metadata: { input_tokens: 12 } })).toEqual({ inputTokens: 12 });
  });

  it('sums split and delta stream usage per field', () => {
    expect(mergeUsage({ inputTokens: 100, outputTokens: 0 }, { inputTokens: 0, outputTokens: 50 })).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(mergeUsage({ inputTokens: 10 }, { outputTokens: 5 })).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(
      mergeUsage({ inputTokens: 100, outputTokens: 1 }, { inputTokens: 0, outputTokens: 50 }, 'max')
    ).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  it('returns null when no usage is present', () => {
    expect(extractUsage({ content: 'hi' })).toBeNull();
    expect(extractUsage(null)).toBeNull();
    expect(extractUsage({ usage_metadata: { input_tokens: -1 } })).toBeNull();
  });
});
