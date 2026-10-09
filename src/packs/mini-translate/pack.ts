import { definePack } from '@shared/app-pack';
import type { PackManifest } from '@shared/app-pack';

/**
 * The translate pad pack. Pad-specific settings live here; ENGINE
 * configuration (providers, keys, routing) stays under Tools →
 * Translation — shared with the agent tool and /tr turns.
 */
export const TRANSLATE_PACK: PackManifest = definePack({
  apiVersion: 1,
  id: 'mini-translate',
  version: '1.2.0',
  kind: 'surface',
  capabilities: ['ui', 'llm'],
  contributions: {
    commands: [{ id: 'tool:translate' }],
    'input-mode': [{ id: 'tool:translate' }],
  },
  configSchema: {
    type: 'object',
    properties: {
      padDebounceMs: { type: 'number', default: 1500, minimum: 0, maximum: 5000 },
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: {
        title: 'Translate',
        description: 'Live translation pad (palette: /tr). Target language comes from /tr or the engine default; engines are configured under Tools → Translation.',
        'config.padDebounceMs': 'Auto-translate delay (ms)',
      },
    },
  },
});
