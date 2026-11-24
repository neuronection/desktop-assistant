import { describe, expect, it, vi } from 'vitest';
import { resolveOcrKey } from '@main/services/ocr/ocrKey';
import { providerSecretKey } from '@main/services/SecretService';
import { LLMProviderType } from '@shared/types';

const lanProvider = {
  id: 'lan-ocr',
  type: LLMProviderType.OPENAI,
  apiBase: 'http://192.168.1.50:8000/v1',
  apiKey: '',
};

describe('resolveOcrKey', () => {
  it('keeps a stored key even when the provider sits on a keyless base', async () => {
    const readSecret = vi.fn(async () => 'sk-lan');
    await expect(resolveOcrKey(lanProvider, readSecret)).resolves.toBe('sk-lan');
    expect(readSecret).toHaveBeenCalledWith(providerSecretKey('lan-ocr'));
  });

  it('falls back to the inline provider key', async () => {
    await expect(resolveOcrKey({ ...lanProvider, apiKey: 'inline' }, async () => null)).resolves.toBe('inline');
  });

  it('returns an empty key when nothing is stored, leaving the placeholder to the gateway', async () => {
    await expect(resolveOcrKey(lanProvider, async () => null)).resolves.toBe('');
  });
});
