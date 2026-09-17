import { LLMProvider, LLMProviderType, Model } from '@shared/types';

/**
 * Sanctioned non-chat model endpoint (the tts.ts precedent): provider
 * model-catalog fetching, owned by the AI layer per ADR-0018 (family
 * rule R5). Every provider branch — URL construction, auth header
 * shape, pagination/normalization, error mapping — lives here;
 * `AIService` is a thin delegator.
 *
 * `apiKey` arrives resolved (keyring-first) from the caller, mirroring
 * `synthesizeSpeech`; the module never touches SecretService itself and
 * never logs key material.
 */
export async function fetchProviderCatalog(provider: LLMProvider, apiKey: string): Promise<Model[]> {
  const base = (provider.apiBase || '').replace(/\/$/, '');
  switch (provider.type) {
    case LLMProviderType.OPENAI:
    case LLMProviderType.GROQ:
    case LLMProviderType.TOGETHER:
    case LLMProviderType.FIREWORKS:
      return fetchOpenAICompatibleModels(provider, base, apiKey);

    case LLMProviderType.ANTHROPIC:
      return fetchAnthropicModels(provider, base, apiKey);

    case LLMProviderType.GOOGLE:
      return fetchGoogleModels(provider, base, apiKey);

    case LLMProviderType.OLLAMA:
      return fetchOllamaModels(provider, base);

    default:
      console.warn(`Model fetching not implemented for provider type: ${provider.type}`);
      return [];
  }
}

async function requireOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
  }
}

function toModels(
  provider: LLMProvider,
  entries: { id: string; name: string }[]
): Model[] {
  return entries.map((model) => ({
    id: model.id,
    name: model.name,
    providerType: provider.type,
    providerId: provider.id,
  }));
}

async function fetchOpenAICompatibleModels(provider: LLMProvider, base: string, apiKey: string): Promise<Model[]> {
  const response = await fetch(`${base}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  await requireOk(response);

  const jsonResponse = (await response.json()) as { data: { id: string }[] };
  return toModels(
    provider,
    jsonResponse.data.map((model) => ({ id: model.id, name: model.id }))
  );
}

async function fetchAnthropicModels(provider: LLMProvider, base: string, apiKey: string): Promise<Model[]> {
  const response = await fetch(`${(base || 'https://api.anthropic.com')}/v1/models`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  });
  await requireOk(response);

  const jsonResponse = (await response.json()) as { data: { id: string; display_name?: string }[] };
  return toModels(
    provider,
    jsonResponse.data.map((model) => ({ id: model.id, name: model.display_name ?? model.id }))
  );
}

async function fetchGoogleModels(provider: LLMProvider, base: string, apiKey: string): Promise<Model[]> {
  const url = `${(base || 'https://generativelanguage.googleapis.com/v1beta')}/models?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  await requireOk(response);

  const jsonResponse = (await response.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return toModels(
    provider,
    (jsonResponse.models ?? [])
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => ({
        id: model.name.replace(/^models\//, ''),
        name: model.displayName ?? model.name.replace(/^models\//, ''),
      }))
  );
}

async function fetchOllamaModels(provider: LLMProvider, base: string): Promise<Model[]> {
  const url = `${base.replace(/\/+$/, '').replace(/\/v1$/, '')}/api/tags`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  await requireOk(response);

  const jsonResponse = (await response.json()) as { models: { name: string }[] };
  return toModels(
    provider,
    jsonResponse.models.map((model) => ({ id: model.name, name: model.name }))
  );
}
