// src/main/services/AIService.ts

import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { aiGateway } from '@main/ai/gateway';
import { AIMessage, LLMProvider, LLMProviderType, Model } from '@shared/types';

export class AIService {
  private configService: MainConfigService;

  constructor() {
    this.configService = MainConfigService.getInstance();
  }

  private async resolveProviderKey(provider: LLMProvider): Promise<string> {
    return (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey;
  }

  async generateResponse(messages: AIMessage[]): Promise<string> {
    const config = this.configService.getConfig();
    const modelId = config.defaultChatModelId;
    if (!modelId) {
      throw new Error('No default chat model is configured in settings.');
    }
    const provider = config.providers.find(p =>
      (p.availableModels ?? []).some(m => m.id === modelId) ||
      (p.customModels ?? []).some(m => m.id === modelId)
    );
    if (!provider) {
      throw new Error(`The provider for the default model '${modelId}' could not be found. Please check your settings.`);
    }
    const apiKey = await this.resolveProviderKey(provider);
    if (!apiKey && provider.type !== LLMProviderType.OLLAMA) {
      throw new Error(`API key for provider '${provider.name}' is not set.`);
    }
    return aiGateway.chat({ provider, modelId, apiKey, messages, task: 'chat' });
  }

  /**
   * Fetches available models from a given provider.
   * @param provider The LLM provider configuration.
   * @returns A promise that resolves to an array of Model objects.
   */
  async fetchAvailableModels(provider: LLMProvider): Promise<Model[]> {
    const hasKey = provider.apiKey || (await SecretService.getInstance().hasSecret(providerSecretKey(provider.id)));
    if (!hasKey && provider.type !== LLMProviderType.OLLAMA) {
      throw new Error(`API key for provider '${provider.name}' is not set. Add the key to fetch the catalog.`);
    }

    try {
      switch (provider.type) {
        case LLMProviderType.OPENAI:
        case LLMProviderType.GROQ:
        case LLMProviderType.TOGETHER:
        case LLMProviderType.FIREWORKS:
          return this.fetchOpenAICompatibleModels(provider);

        case LLMProviderType.ANTHROPIC:
          return this.fetchAnthropicModels(provider);

        case LLMProviderType.GOOGLE:
          return this.fetchGoogleModels(provider);

        case LLMProviderType.OLLAMA:
          return this.fetchOllamaModels(provider);

        default:
          console.warn(`Model fetching not implemented for provider type: ${provider.type}`);
          return [];
      }
    } catch (error) {
      console.error(`Failed to fetch models for provider ${provider.name}:`, error);
      return [];
    }
  }

  /**
   * Fetches models from an OpenAI-compatible API endpoint.
   */
  private async fetchOpenAICompatibleModels(provider: LLMProvider): Promise<Model[]> {
    const url = `${provider.apiBase.replace(/\/$/, '')}/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${await this.resolveProviderKey(provider)}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }

    const jsonResponse = await response.json() as { data: { id: string }[] };

    return jsonResponse.data.map(model => ({
      id: model.id,
      name: model.id,
      providerType: provider.type,
      providerId: provider.id,
    }));
  }

  /**
   * Fetches models from the Anthropic API.
   */
  private async fetchAnthropicModels(provider: LLMProvider): Promise<Model[]> {
    const url = `${(provider.apiBase || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': await this.resolveProviderKey(provider),
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }

    const jsonResponse = await response.json() as { data: { id: string; display_name?: string }[] };

    return jsonResponse.data.map(model => ({
      id: model.id,
      name: model.display_name ?? model.id,
      providerType: provider.type,
      providerId: provider.id,
    }));
  }

  /**
   * Fetches models from the Google Gemini API.
   */
  private async fetchGoogleModels(provider: LLMProvider): Promise<Model[]> {
    const base = (provider.apiBase || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const url = `${base}/models?key=${encodeURIComponent(await this.resolveProviderKey(provider))}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }

    const jsonResponse = await response.json() as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };

    return (jsonResponse.models ?? [])
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
      .map(model => ({
        id: model.name.replace(/^models\//, ''),
        name: model.displayName ?? model.name.replace(/^models\//, ''),
        providerType: provider.type,
        providerId: provider.id,
      }));
  }

  /**
   * Fetches models from an Ollama API endpoint.
   */
  private async fetchOllamaModels(provider: LLMProvider): Promise<Model[]> {
    const base = provider.apiBase.replace(/\/+$/, '').replace(/\/v1$/, '');
    const url = `${base}/api/tags`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }

    const jsonResponse = await response.json() as { models: { name: string }[] };

    return jsonResponse.models.map(model => ({
      id: model.name,
      name: model.name,
      providerType: provider.type,
      providerId: provider.id,
    }));
  }
}
