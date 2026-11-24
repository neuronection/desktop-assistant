import { describe, it, expect } from 'vitest';
import { LLMProviderType, type LLMProvider } from '@shared/types';
import { formatModelLabel, providerDisplayNames } from '@shared/ai/modelLabel';

const provider = (overrides: Partial<LLMProvider> = {}): LLMProvider => ({
  id: 'p1',
  name: 'Local Ollama',
  type: LLMProviderType.OLLAMA,
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

describe('providerDisplayNames', () => {
  it('keeps the plain name when provider names are unique', () => {
    const names = providerDisplayNames([
      provider({ id: 'p1', name: 'OpenAI', apiBase: 'https://api.openai.com/v1' }),
      provider({ id: 'p2', name: 'Local Ollama', apiBase: 'http://localhost:11434/v1' }),
    ]);
    expect(names.get('p1')).toBe('OpenAI');
    expect(names.get('p2')).toBe('Local Ollama');
  });

  it('appends the endpoint host when two providers share a name', () => {
    const names = providerDisplayNames([
      provider({ id: 'p1', apiBase: 'http://192.168.1.50:11434/v1' }),
      provider({ id: 'p2', apiBase: 'http://localhost:11434/v1' }),
    ]);
    expect(names.get('p1')).toBe('Local Ollama (192.168.1.50)');
    expect(names.get('p2')).toBe('Local Ollama (localhost)');
  });

  it('suffixes every provider of a shared name, not just the second', () => {
    const names = providerDisplayNames([
      provider({ id: 'p1', apiBase: 'https://a.example/v1' }),
      provider({ id: 'p2', apiBase: 'https://b.example/v1' }),
      provider({ id: 'p3', name: 'OpenAI', apiBase: 'https://api.openai.com/v1' }),
    ]);
    expect(names.get('p1')).toBe('Local Ollama (a.example)');
    expect(names.get('p2')).toBe('Local Ollama (b.example)');
    expect(names.get('p3')).toBe('OpenAI');
  });

  it('strips IPv6 brackets and falls back to the raw endpoint on garbage', () => {
    const names = providerDisplayNames([
      provider({ id: 'p1', apiBase: 'http://[::1]:11434/v1' }),
      provider({ id: 'p2', apiBase: 'not a url' }),
      provider({ id: 'p3', apiBase: '' }),
    ]);
    expect(names.get('p1')).toBe('Local Ollama (::1)');
    expect(names.get('p2')).toBe('Local Ollama (not a url)');
    expect(names.get('p3')).toBe('Local Ollama (local)');
  });

  it('never throws on an undefined endpoint', () => {
    const names = providerDisplayNames([provider({ id: 'p1', apiBase: undefined as unknown as string })]);
    expect(names.get('p1')).toBe('Local Ollama');
  });
});

describe('formatModelLabel', () => {
  it('joins the provider and the model with the shared separator', () => {
    expect(formatModelLabel('OpenAI', 'GPT-4o mini')).toBe('OpenAI · GPT-4o mini');
  });

  it('keeps a disambiguated provider name intact', () => {
    expect(formatModelLabel('Local Ollama (192.168.1.50)', 'qwen3:8b')).toBe(
      'Local Ollama (192.168.1.50) · qwen3:8b'
    );
  });
});
