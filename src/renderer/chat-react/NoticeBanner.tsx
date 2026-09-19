import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import type { JSX } from 'react';
import type { NoticeState } from './notice';
import { TEXT } from '@shared/constants/text';

export interface NoticeBannerProps {
  notice: NoticeState;
  onDismiss: () => void;
  /** Actionable error deep-link (e.g. no chat model → setup / model picker). */
  action?: { label: string; onActivate: () => void };
  className?: string;
}

const BANNER_STYLES: Record<NoticeState['type'], { icon: typeof Info; className: string }> = {
  error: { icon: TriangleAlert, className: 'border-[var(--as-danger)]/40 bg-[var(--as-danger)]/10' },
  info: { icon: Info, className: 'border-amber-500/40 bg-amber-500/10' },
  success: { icon: CheckCircle2, className: 'border-emerald-500/40 bg-emerald-500/10' },
};

export function NoticeBanner({ notice, onDismiss, action, className = '' }: NoticeBannerProps): JSX.Element {
  const error = notice.type === 'error';
  const { icon: Icon, className: variantClass } = BANNER_STYLES[notice.type];
  return (
    <div
      data-no-drag
      role={error ? 'alert' : 'status'}
      className={`da-rise flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${variantClass} ${className}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">
        {notice.message}
        {action && (
          <span className="mt-2 flex">
            <button
              type="button"
              className="rounded-md border border-[var(--as-danger)]/50 px-2 py-1 font-medium transition-colors hover:bg-[var(--as-danger)]/20"
              onClick={action.onActivate}
            >
              {action.label}
            </button>
          </span>
        )}
      </span>
      <button type="button" className="opacity-60 hover:opacity-100" onClick={onDismiss} aria-label={TEXT.NOTICE_DISMISS}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
