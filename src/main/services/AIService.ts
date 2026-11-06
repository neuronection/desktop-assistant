// src/main/services/AIService.ts

import { MainConfigService } from '@main/services/ConfigService';
import { SecretService, providerSecretKey } from '@main/services/SecretService';
import { fetchProviderCatalog } from '@main/ai/catalog';
import { LLMProvider, LLMProviderType, Model } from '@shared/types';

export class AIService {
  private configService: MainConfigService;

  constructor() {
    this.configService = MainConfigService.getInstance();
  }

  private async resolveProviderKey(provider: LLMProvider): Promise<string> {
    return (await SecretService.getInstance().getSecret(providerSecretKey(provider.id))) ?? provider.apiKey;
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
