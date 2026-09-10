import { useEffect, useRef, type JSX } from 'react';
import { Eraser, X } from 'lucide-react';
import { TEXT } from '@shared/constants/text';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

export const VOICE_BAR_PEAKS = [0.5, 0.85, 1, 0.75, 0.55];

interface VoiceIndicatorProps {
  state: VoiceState;
  level: number;
  interim?: string;
  onCancel?: () => void;
  onClearInterim?: () => void;
}

export function VoiceIndicator(props: VoiceIndicatorProps): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) {
      body.scrollTop = body.scrollHeight;
    }
  }, [props.interim]);

  if (props.state === 'idle') {
    return null;
  }
  const transcribing = props.state === 'transcribing';
  const level = Math.min(1, Math.max(0.08, props.level));
  return (
    <div
      data-no-drag
      role="status"
      className="da-rise mb-1 space-y-1.5 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] px-2.5 py-2"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-4 shrink-0 items-center gap-[3px]" aria-hidden={true}>
          {VOICE_BAR_PEAKS.map((peak, index) => (
            <span
              key={peak}
              className={`da-voice-bar w-[3px] rounded-full bg-[var(--as-primary)] ${transcribing ? 'da-voice-wave' : ''}`}
              style={{
                height: `${Math.round(transcribing ? 12 : 4 + level * peak * 12)}px`,
                animationDelay: transcribing ? `${index * 0.14}s` : undefined,
              }}
            />
          ))}
        </span>
        <span className="text-xs text-[var(--as-muted-fg)]">{transcribing ? TEXT.VOICE_TRANSCRIBING : TEXT.VOICE_LISTENING}</span>
        <span className="flex-1" />
        {props.interim && props.onClearInterim && props.state === 'recording' ? (
          <button
            type="button"
            aria-label={TEXT.VOICE_CLEAR_PENDING}
            title={TEXT.VOICE_CLEAR_PENDING}
            className="rounded-full p-1 text-[var(--as-muted-fg)] transition-colors hover:bg-[var(--as-muted)] hover:text-[var(--as-fg)]"
            onClick={props.onClearInterim}
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden={true} />
          </button>
        ) : null}
        {props.state === 'recording' && props.onCancel ? (
          <button
            type="button"
            aria-label={TEXT.VOICE_CANCEL}
            title={TEXT.VOICE_CANCEL}
            className="rounded-full p-1 text-[var(--as-muted-fg)] transition-colors hover:bg-[var(--as-muted)] hover:text-[var(--as-danger)]"
            onClick={props.onCancel}
          >
            <X className="h-3.5 w-3.5" aria-hidden={true} />
          </button>
        ) : null}
      </div>
      {props.interim ? (
        <div ref={bodyRef} className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed opacity-80">
          {props.interim}
        </div>
      ) : null}
    </div>
  );
}
