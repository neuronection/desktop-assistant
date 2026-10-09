import { Calculator } from 'lucide-react';
import { TEXT } from '@shared/constants/text';
import type { SurfaceRendererBinding } from '../../miniApps';

/** The calculator's Tier-1 renderer binding (host code, keyed by pack id). */
export const calcRenderer: SurfaceRendererBinding = {
  packId: 'mini-calc',
  modeId: 'calc:evaluate',
  match: { action: 'calc:evaluate' },
  icon: Calculator,
  placeholder: TEXT.COMMAND_MINI_CALC_PLACEHOLDER,
  hint: TEXT.COMMAND_MINI_HINT,
};
