import { Button } from '@neuronection/assistant-ui/button';
import { Volume2 } from 'lucide-react';
import type { JSX } from 'react';
import { TEXT } from '@shared/constants/text';

export interface SpeechDiscoveryCardProps {
  /** A model is assigned to the `tts` task. */
  assigned: boolean;
  onSetupVoice: () => void;
}

/**
 * Discovery inversion (plan 58 §6): the unconfigured user sees the setup
 * card. Once a speech model is assigned the card disappears — the chords
 * live in the Shortcuts sheet (plan 59), the one place discoverability
 * belongs.
 */
export function SpeechDiscoveryCard({ assigned, onSetupVoice }: SpeechDiscoveryCardProps): JSX.Element | null {
  if (assigned) {
    return null;
  }
  return (
    <div
      data-no-drag
      className="da-rise rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] px-3 py-2.5"
      role="note"
      aria-label={TEXT.SPEECH_DISCOVERY_SETUP_TITLE}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Volume2 className="h-3 w-3 text-[var(--as-primary)]" aria-hidden />
        {TEXT.SPEECH_DISCOVERY_SETUP_TITLE}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--as-muted-fg)]">{TEXT.SPEECH_DISCOVERY_SETUP_BODY}</p>
      <div className="mt-2">
        <Button variant="outline" size="sm" onClick={onSetupVoice}>
          {TEXT.SPEECH_DISCOVERY_SETUP_CTA}
        </Button>
      </div>
    </div>
  );
}
