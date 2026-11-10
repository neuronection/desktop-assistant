import type { JSX } from 'react';
import { FlaskConical } from 'lucide-react';
import { TEXT } from '@shared/constants/text';

/** The one "beta" chip (plan 71) — render next to any feature listed in `BETA_FEATURE_IDS`. */
export function BetaTag({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      data-testid="beta-tag"
      title={TEXT.BETA_TAG_HINT}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--as-warning)]/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--as-warning)] ${className}`}
    >
      <FlaskConical className="h-2.5 w-2.5" aria-hidden />
      {TEXT.BETA_TAG}
    </span>
  );
}
