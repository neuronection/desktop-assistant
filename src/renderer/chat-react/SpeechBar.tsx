import { Loader2, Square, Volume2 } from 'lucide-react';
import type { JSX } from 'react';
import { TEXT } from '@shared/constants/text';

export const SPEECH_BAR_PEAKS = [0.45, 0.8, 1, 0.7, 0.5, 0.85, 0.6];

export type SpeechBarState = 'idle' | 'loading' | 'speaking';

export interface SpeechBarProps {
  /** Speech progress: synthesizing (loading) or playing aloud (speaking). */
  state?: SpeechBarState;
  onStop?: () => void;
  className?: string;
}

/**
 * In-flow speech indicator (plan 12 §6): "preparing audio" while the
 * synthesis roundtrip is in flight (immediate click feedback), then the
 * da-voice-wave animation with an inline stop control while the reply
 * is spoken. Hidden when idle.
 */
export function SpeechBar(props: SpeechBarProps): JSX.Element | null {
  if (!props.state || props.state === 'idle') {
    return null;
  }
  const shell = `da-rise mb-1 flex items-center gap-2.5 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] px-2.5 py-2 ${props.className ?? ''}`;
  if (props.state === 'loading') {
    return (
      <div data-no-drag role="status" aria-label={TEXT.SPEECH_PREPARING} className={shell}>
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--as-primary)]" aria-hidden={true} />
        <span className="text-xs text-[var(--as-muted-fg)]">{TEXT.SPEECH_PREPARING}</span>
      </div>
    );
  }
  if (!props.onStop) {
    return null;
  }
  return (
    <div
      data-no-drag
      role="status"
      aria-label={TEXT.SPEECH_SPEAKING}
      className={shell}
    >
      <Volume2 className="h-3.5 w-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden={true} />
      <span className="flex h-4 shrink-0 items-center gap-[3px]" aria-hidden={true}>
        {SPEECH_BAR_PEAKS.map((peak, index) => (
          <span
            key={index}
            className="da-voice-bar da-voice-wave w-[3px] rounded-full bg-[var(--as-primary)]"
            style={{
              height: '12px',
              animationDelay: `${index * 0.12}s`,
              animationDuration: `${0.7 + peak * 0.3}s`,
            }}
          />
        ))}
      </span>
      <span className="text-xs text-[var(--as-muted-fg)]">{TEXT.SPEECH_SPEAKING}</span>
      <span className="flex-1" />
      <button
        type="button"
        aria-label={TEXT.SPEECH_STOP}
        title={TEXT.SPEECH_STOP}
        className="rounded-full p-1 text-[var(--as-muted-fg)] transition-colors hover:bg-[var(--as-muted)] hover:text-[var(--as-danger)]"
        onClick={props.onStop}
      >
        <Square className="h-3.5 w-3.5" aria-hidden={true} />
      </button>
    </div>
  );
}
