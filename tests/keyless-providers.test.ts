import { describe, it, expect } from 'vitest';
import { isKeylessProvider } from '@shared/ai/local';
import { LLMProviderType, type LLMProvider } from '@shared/types';

function provider(
  type: LLMProviderType,
  apiBase: string | undefined
): Pick<LLMProvider, 'type' | 'apiBase'> {
  return { type, apiBase } as Pick<LLMProvider, 'type' | 'apiBase'>;
}

describe('isKeylessProvider', () => {
  it('treats every ollama provider as keyless whatever its base', () => {
    expect(isKeylessProvider(provider(LLMProviderType.OLLAMA, 'https://api.example.test/v1'))).toBe(true);
    expect(isKeylessProvider(provider(LLMProviderType.OLLAMA, undefined))).toBe(true);
  });

  it('treats loopback, docker-host, mDNS and RFC1918 bases as keyless', () => {
    for (const apiBase of [
      'http://localhost:11434/v1',
      'http://[::1]:11434/v1',
      'http://host.docker.internal:11434/v1',
      'https://box.local/v1',
      'http://192.168.1.50:8000/v1',
    ]) {
      expect(isKeylessProvider(provider(LLMProviderType.OPENAI, apiBase)), apiBase).toBe(true);
    }
  });

  it('does not treat a public host, a lookalike domain or a missing base as keyless', () => {
    for (const apiBase of [
      'http://localhost.evil.com/v1',
      'https://api.example.test/v1',
      undefined,
    ]) {
      expect(isKeylessProvider(provider(LLMProviderType.OPENAI, apiBase)), String(apiBase)).toBe(false);
    }
  });
});
