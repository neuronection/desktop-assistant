/**
 * Translation engine catalog — desktop's projection for the family
 * `translation-providers` module. App data for now (desktop is the only
 * translation consumer); promote to a vendored family contract like
 * `search-providers.json` when a second product adopts translation.
 */
import type { TranslationEngineCatalog } from '@neuronection/assistant-ui/translation-providers';

export const TRANSLATION_CATALOG: TranslationEngineCatalog = {
  order: ['libretranslate', 'deepl'],
  entries: {
    libretranslate: {
      label: 'LibreTranslate',
      requiresKey: false,
      optionalKey: true,
      keyUrl: null,
      baseUrlRequired: true,
      baseUrl: null,
      baseUrlHint: 'https://libretranslate.local',
      notes: 'Self-hosted translation server — the JSON API must be enabled.',
      hosting: 'self-hosted',
    },
    deepl: {
      label: 'DeepL',
      requiresKey: true,
      optionalKey: false,
      keyUrl: 'https://www.deepl.com/pro-api',
      baseUrlRequired: false,
      baseUrl: null,
      baseUrlHint: 'https://api-free.deepl.com',
      notes: 'Free keys ending in “:fx” route to the free API automatically.',
      hosting: 'cloud',
    },
  },
};

/** Desktop-only per-instance tuning field (config `timeoutMs`) rendered
 * by the library settings form's Advanced disclosure. */
export const TRANSLATION_EXTRA_FIELDS = [
  {
    id: 'timeout_ms',
    label: 'Timeout (ms)',
    required: false,
    type: 'number' as const,
    advanced: true,
    placeholder: '8000',
  },
];
