import { definePack } from '@shared/app-pack';
import type { PackManifest } from '@shared/app-pack';

/**
 * Bundled Tier-1 surface packs (plan 26 S7 dogfooding): the calculator
 * and translate-pad takeover surfaces defined ON the pack contract —
 * kind surface (no pipeline), `ui` capability, commands + input-mode
 * slot contributions. The interactive renderers remain host-owned code
 * (chat-react/miniApps.tsx) keyed by pack id; the manifests are the
 * declarative definition, validated and installed through the same
 * registry path as any pack. Pad-specific settings live in the pack
 * config (S8 smoke round 3); ENGINE configuration (providers, keys,
 * routing) stays under Tools → Translation — shared with the agent tool.
 */

export const CALC_PACK: PackManifest = definePack({
  apiVersion: 1,
  id: 'mini-calc',
  version: '1.1.0',
  kind: 'surface',
  capabilities: ['ui'],
  contributions: {
    commands: [{ id: 'calc:evaluate' }],
    'input-mode': [{ id: 'calc:evaluate' }],
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: {
        title: 'Calculator',
        description: 'Takes over the launcher input as a live calculator (palette: calc).',
      },
    },
  },
});

export const TRANSLATE_PACK: PackManifest = definePack({
  apiVersion: 1,
  id: 'mini-translate',
  version: '1.1.0',
  kind: 'surface',
  capabilities: ['ui', 'llm'],
  contributions: {
    commands: [{ id: 'tool:translate' }],
    'input-mode': [{ id: 'tool:translate' }],
  },
  configSchema: {
    type: 'object',
    properties: {
      defaultTarget: {
        type: 'string',
        default: '',
        pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$',
        maxLength: 12,
      },
      padDebounceMs: { type: 'number', default: 1500, minimum: 0, maximum: 5000 },
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: {
        title: 'Translate pad',
        description: 'Live translation pad (palette: /tr). Translation engines are configured under Tools → Translation.',
        'config.defaultTarget': 'Default target language (empty = engine default)',
        'config.padDebounceMs': 'Auto-translate delay (ms)',
      },
    },
  },
});

export const BUNDLED_CODE_PACKS: PackManifest[] = [CALC_PACK, TRANSLATE_PACK];
