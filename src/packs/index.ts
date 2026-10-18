import type { CommandEntry } from '@shared/commands';
import { TEXT } from '@shared/constants/text';
import calcManifest from './mini-calc/manifest.json';
import translateManifest from './mini-translate/manifest.json';
import referenceManifest from './file-deletion-review/manifest.json';

/**
 * Bundled packs (plan 26): ONE directory per app — `manifest.json` at
 * the pack root (the family file form — never code-declared), pure
 * logic (`evaluate.ts`), renderer binding (`renderer.ts`). This index
 * is the main-process registration point (manifests + host command
 * bindings); the renderer registry lives in `renderer.ts`. Tier 2
 * (imported code packs behind an RPC shim) reuses this layout as its
 * template.
 */

export const CALC_PACK: unknown = calcManifest;
export const TRANSLATE_PACK: unknown = translateManifest;
export const REFERENCE_PACK: unknown = referenceManifest;
export const ALL_BUNDLED_PACKS: unknown[] = [CALC_PACK, TRANSLATE_PACK, REFERENCE_PACK];
export { evaluateExpression, formatCalcResult } from './mini-calc/evaluate';

/**
 * Command executor bindings for surface-pack `commands` contributions:
 * the manifest declares a command id; the host supplies its palette
 * entry + builtin action here. Absent binding = the command exists
 * through other paths (e.g. the native `translate` tool entry).
 */
export const SURFACE_COMMAND_BINDINGS: Record<string, Omit<CommandEntry, 'kind' | 'source' | 'scopes'>> = {
  'calc:evaluate': {
    id: 'calc:evaluate',
    title: TEXT.COMMAND_CALCULATOR,
    subtitle: TEXT.COMMAND_CALCULATOR_SUBTITLE,
    category: 'tools',
    icon: 'calculator',
    aliases: ['calc'],
    slash: 'calc',
    keywords: TEXT.COMMAND_CALCULATOR_KEYWORDS.split(' '),
    args: [{ name: 'expression', required: true, type: 'string' }],
    action: 'calc:evaluate',
  },
};
