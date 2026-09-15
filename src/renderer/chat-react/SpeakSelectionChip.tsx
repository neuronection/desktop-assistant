import { useEffect, useState } from 'react';
import { Volume2, X } from 'lucide-react';
import type { JSX } from 'react';
import { TEXT } from '@shared/constants/text';

/** Non-empty text selections inside the window (capped for speech). */
export function useWindowSelection(enabled: boolean, cap = 2000): string {
  const [selection, setSelection] = useState('');

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const handler = (): void => {
      const text = window.getSelection()?.toString().trim() ?? '';
      setSelection(text.length > 1 ? text.slice(0, cap) : '');
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [enabled, cap]);

  return selection;
}

export interface SpeakSelectionChipProps {
  selection: string;
  onSpeak: (text: string) => void;
  onDismiss?: () => void;
  className?: string;
}

/** In-flow affordance shown while the user has text selected: speaks it. */
export function SpeakSelectionChip(props: SpeakSelectionChipProps): JSX.Element | null {
  if (!props.selection) {
    return null;
  }
  return (
    <div
      data-no-drag
      className={`da-rise flex items-center gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] px-2.5 py-1.5 text-xs ${props.className ?? ''}`}
    >
      <Volume2 className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden={true} />
      <span className="min-w-0 flex-1 truncate opacity-70" title={props.selection}>
        {props.selection}
      </span>
      <button
        type="button"
        className="shrink-0 rounded-full border border-[var(--as-border)] px-2 py-0.5 font-medium transition-colors hover:border-[var(--as-primary)] hover:text-[var(--as-primary)]"
        onClick={() => props.onSpeak(props.selection)}
      >
        {TEXT.SPEECH_SPEAK_SELECTION}
      </button>
      {props.onDismiss && (
        <button
          type="button"
          aria-label={TEXT.SPEECH_DISMISS_SELECTION}
          className="shrink-0 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
          onClick={props.onDismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden={true} />
        </button>
      )}
    </div>
  );
}
