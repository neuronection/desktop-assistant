import { Calculator } from 'lucide-react';
import { evaluateExpression, formatCalcResult } from '@shared/commands';
import { TEXT, interpolate } from '@shared/constants/text';
import type { SurfaceLiveState, SurfaceRendererBinding } from '../../miniApps';

/** The calculator's live behavior: pure synchronous evaluation of the input. */
function useCalcLive(app: Parameters<NonNullable<SurfaceRendererBinding['useLive']>>[0], input: string): SurfaceLiveState | null {
  if (!app) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { copyValue: null, rows: [] };
  }
  const result = evaluateExpression(trimmed);
  if (!result.ok) {
    return { copyValue: null, rows: [] };
  }
  const value = formatCalcResult(result.value);
  return {
    copyValue: value,
    rows: [{ kind: 'result', variant: 'compact', label: interpolate(TEXT.COMMAND_CALC_RESULT, { value }), value }],
  };
}

/** The calculator's Tier-1 renderer binding (host code, keyed by pack id). */
export const calcRenderer: SurfaceRendererBinding = {
  packId: 'mini-calc',
  modeId: 'calc:evaluate',
  match: { action: 'calc:evaluate' },
  icon: Calculator,
  placeholder: TEXT.COMMAND_MINI_CALC_PLACEHOLDER,
  hint: TEXT.COMMAND_MINI_HINT,
  useLive: useCalcLive,
};
