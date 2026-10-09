import { definePack } from '@shared/app-pack';
import type { PackManifest } from '@shared/app-pack';

/**
 * Bundled Tier-1 surface packs (plan 26 S7 dogfooding): the calculator
 * and translate-pad takeover surfaces defined ON the pack contract —
 * kind surface (no pipeline), `ui` capability, commands + input-mode
 * slot contributions. The interactive renderers remain host-owned code
 * (chat-react/miniApps.tsx) keyed by pack id; the manifests are the
 * declarative definition, validated and installed through the same
 * registry path as any pack.
 */

export const CALC_PACK: PackManifest = definePack({
  apiVersion: 1,
  id: 'mini-calc',
  version: '1.0.0',
  kind: 'surface',
  capabilities: ['ui'],
  contributions: {
    commands: [{ id: 'calc:evaluate' }],
    'input-mode': [{ id: 'calc:evaluate' }],
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: { title: 'Calculator' },
    },
  },
});

export const TRANSLATE_PACK: PackManifest = definePack({
  apiVersion: 1,
  id: 'mini-translate',
  version: '1.0.0',
  kind: 'surface',
  capabilities: ['ui', 'llm'],
  contributions: {
    commands: [{ id: 'tool:translate' }],
    'input-mode': [{ id: 'tool:translate' }],
  },
  i18n: {
    defaultLocale: 'en',
    locales: {
      en: { title: 'Translate pad' },
    },
  },
});

export const BUNDLED_CODE_PACKS: PackManifest[] = [CALC_PACK, TRANSLATE_PACK];
