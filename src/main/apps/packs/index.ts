import type { CommandEntry } from '@shared/commands';
import { TEXT } from '@shared/constants/text';
import { CALC_PACK } from './mini-calc/manifest';
import { TRANSLATE_PACK } from './mini-translate/manifest';

/**
 * Bundled code packs (plan 26; modularized S8): each app's manifest and
 * host bindings live under `packs/<id>/`. The HOST binds contribution
 * ids to executors here (ADR-0029 Tier 1 — bundled code shipped with
 * the app); Tier 2 (imported code packs behind an RPC shim) will reuse
 * this layout as its template.
 */

export const BUNDLED_CODE_PACKS = [CALC_PACK, TRANSLATE_PACK];
export { CALC_PACK } from './mini-calc/manifest';
export { TRANSLATE_PACK } from './mini-translate/manifest';

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
