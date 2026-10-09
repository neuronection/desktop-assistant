import type { CommandEntry } from '@shared/commands';
import { TEXT } from '@shared/constants/text';
import { CALC_PACK } from './mini-calc/pack';
import { TRANSLATE_PACK } from './mini-translate/pack';
import referencePack from './file-deletion-review/pack.json';

/**
 * Bundled packs (plan 26): ONE directory per app — manifest (`pack.ts` /
 * `pack.json`), pure logic (`evaluate.ts`), renderer binding
 * (`renderer.ts`). This index is the main-process registration point
 * (manifests + host command bindings); the renderer registry lives in
 * `renderer.ts`. Tier 2 (imported code packs behind an RPC shim) reuses
 * this layout as its template.
 */

export const BUNDLED_CODE_PACKS = [CALC_PACK, TRANSLATE_PACK];
export { CALC_PACK } from './mini-calc/pack';
export { TRANSLATE_PACK } from './mini-translate/pack';
export { evaluateExpression, formatCalcResult } from './mini-calc/evaluate';
export const DATA_PACKS: unknown[] = [referencePack];
export const ALL_BUNDLED_PACKS: unknown[] = [...BUNDLED_CODE_PACKS, ...DATA_PACKS];

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
