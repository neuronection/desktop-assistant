import type { LLMProvider } from '@shared/types';
import { providerSecretKey } from '@main/services/SecretService';

/**
 * The OCR key resolver: a stored key always wins, even when the provider sits
 * on a keyless base (a key-protected LAN server is common). Only when neither a
 * stored key nor an inline `apiKey` exists does it hand back an empty string,
 * which `OcrService` and the gateway turn into the local placeholder.
 */
export async function resolveOcrKey(
  provider: Pick<LLMProvider, 'id' | 'apiKey'>,
  readSecret: (key: string) => Promise<string | null>
): Promise<string> {
  return (await readSecret(providerSecretKey(provider.id))) ?? provider.apiKey ?? '';
}
