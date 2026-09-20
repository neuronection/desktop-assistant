import { useEffect, useRef, type JSX } from 'react';
import { X } from 'lucide-react';
import { SponsorCard } from '@neuronection/assistant-ui/about';
import { TEXT } from '@shared/constants/text';
import { SPONSOR_CHANNELS } from '@renderer/shared/funding';

export interface FundCardProps {
  onClose: () => void;
}

/**
 * In-flow launcher fund card: the SponsorCard channels (Buy Me a Coffee
 * first, more channels later) rendered above the composer like the other
 * launcher chrome — never a fixed overlay.
 */
export function FundCard({ onClose }: FundCardProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-no-drag
      role="dialog"
      aria-label={TEXT.FUND_TITLE}
      className="da-rise mb-1 ml-auto w-72 overflow-hidden rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-1.5 text-sm shadow-xl"
    >
      <div className="mb-0.5 flex items-center gap-1 px-0.5 py-0.5">
        <span className="text-xs font-semibold opacity-80">{TEXT.FUND_TITLE}</span>
        <button
          type="button"
          aria-label={TEXT.CLOSE_BUTTON}
          className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md opacity-60 hover:bg-[var(--as-secondary)] hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
      <SponsorCard
        channels={SPONSOR_CHANNELS}
        columns={1}
        className="border-none bg-transparent p-0 shadow-none"
      />
    </div>
  );
}
