// src/main/services/AIService.ts

import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { aiGateway } from '@main/ai/gateway';
import { fetchProviderCatalog } from '@main/ai/catalog';
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
   * Fetches available models from a given provider. Thin delegator —
   * the per-provider branches live in the AI layer (`ai/catalog.ts`,
   * ADR-0018).
   * @param provider The LLM provider configuration.
   * @returns A promise that resolves to an array of Model objects.
   */
  async fetchAvailableModels(provider: LLMProvider): Promise<Model[]> {
    const hasKey = provider.apiKey || (await SecretService.getInstance().hasSecret(providerSecretKey(provider.id)));
    if (!hasKey && provider.type !== LLMProviderType.OLLAMA) {
      throw new Error(`API key for provider '${provider.name}' is not set. Add the key to fetch the catalog.`);
    }

    try {
      return await fetchProviderCatalog(provider, await this.resolveProviderKey(provider));
    } catch (error) {
      console.error(`Failed to fetch models for provider ${provider.name}:`, error);
      return [];
    }
  }
}
