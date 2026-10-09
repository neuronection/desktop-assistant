import { Languages } from 'lucide-react';
import { TEXT } from '@shared/constants/text';
import type { SurfaceRendererBinding } from '../../miniApps';

/** The translate pad's Tier-1 renderer binding (host code, keyed by pack id). */
export const translateRenderer: SurfaceRendererBinding = {
  packId: 'mini-translate',
  modeId: 'tool:translate',
  match: { toolName: 'translate' },
  icon: Languages,
  placeholder: TEXT.COMMAND_MINI_TRANSLATE_PLACEHOLDER,
  hint: TEXT.COMMAND_MINI_TRANSLATE_HINT,
  applyOpenOptions: (mini, options, config) => {
    const packDefault = typeof config.defaultTarget === 'string' ? config.defaultTarget.trim().toLowerCase() : '';
    const targetCode = options.targetCode?.trim().toLowerCase() || packDefault || null;
    return { ...mini, targetCode, title: targetCode ? `${mini.title} → ${targetCode}` : mini.title };
  },
};
