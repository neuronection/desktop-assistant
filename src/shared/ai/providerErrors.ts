import { KEY_PREFIX_HINTS, ProviderPresetKey, guessPresetForKey } from '@shared/ai/providerPresets';

export type ProviderErrorCode =
  | 'invalid_key'
  | 'insufficient_credit'
  | 'new_user_quota'
  | 'region_unavailable'
  | 'timeout'
  | 'local_not_running'
  | 'unknown';

export type SetupProviderErrorCode = ProviderErrorCode | 'unknown_preset';

export interface ProviderErrorInput {
  status?: number | null;
  message: string;
  name?: string;
  localProvider: boolean;
  apiKey?: string;
  attemptedPreset?: ProviderPresetKey;
}

export interface ClassifiedProviderError {
  code: ProviderErrorCode;
  suspectedVendor?: ProviderPresetKey;
}

const CONNECTION_FAILURE_PATTERN = /ECONNREFUSED|connection refused|fetch failed|failed to fetch|ENOTFOUND|ECONNRESET|network/i;
const REGION_PATTERN = /region|country|geo|not available in|unavailable in your|unsupported_country/i;
const CREDIT_PATTERN = /insufficient_quota|insufficient (?:credit|quota|balance)|billing/i;

export function extractErrorStatus(message: string): number | null {
  const match = message.match(/status (\d{3})/);
  return match ? Number(match[1]) : null;
}

export function classifyProviderError(input: ProviderErrorInput): ClassifiedProviderError {
  const { status, message, name, localProvider, apiKey, attemptedPreset } = input;

  if (name === 'AbortError' || /\babort/i.test(message)) {
    return { code: 'timeout' };
  }

  if (localProvider && CONNECTION_FAILURE_PATTERN.test(message)) {
    return { code: 'local_not_running' };
  }

  if (status === 401) {
    const classified: ClassifiedProviderError = { code: 'invalid_key' };
    if (attemptedPreset && apiKey) {
      const guess = guessPresetForKey(apiKey);
      if (guess && guess !== attemptedPreset) {
        classified.suspectedVendor = guess;
      }
    }
    return classified;
  }

  if (status === 402 || CREDIT_PATTERN.test(message)) {
    return { code: 'insufficient_credit' };
  }

  if (status === 429) {
    return { code: 'new_user_quota' };
  }

  if (status === 403 && REGION_PATTERN.test(message)) {
    return { code: 'region_unavailable' };
  }

  return { code: 'unknown' };
}

export { KEY_PREFIX_HINTS };
