import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
import type { JSX } from 'react';
import type { NoticeState } from './notice';
import { TEXT } from '@shared/constants/text';

export interface NoticeBannerProps {
  notice: NoticeState;
  onDismiss: () => void;
  className?: string;
}

export function NoticeBanner({ notice, onDismiss, className = '' }: NoticeBannerProps): JSX.Element {
  const error = notice.type === 'error';
  return (
    <div
      data-no-drag
      role={error ? 'alert' : 'status'}
      className={`da-rise flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
        error
          ? 'border-[var(--as-danger)]/40 bg-[var(--as-danger)]/10'
          : 'border-emerald-500/40 bg-emerald-500/10'
      } ${className}`}
    >
      {error ? (
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 break-words">{notice.message}</span>
      <button type="button" className="opacity-60 hover:opacity-100" onClick={onDismiss} aria-label={TEXT.NOTICE_DISMISS}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
