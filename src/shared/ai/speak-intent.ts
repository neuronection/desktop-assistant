/**
 * Prompt-armed auto-speak (plan 24 S5): the user's own prompt decides
 * whether a reply is spoken. The judgment belongs to a decision engine
 * (a `noul` over the user's input in the pre-model batch); the model's
 * reply can never arm a side effect — the injection guard (D13).
 */

export const SPEAK_INTENT_QUESTION_ID = '__speak__';

/** The one noul question the pre-model batch asks. */
export const SPEAK_INTENT_QUESTION = {
  id: SPEAK_INTENT_QUESTION_ID,
  type: 'noul' as const,
  instructions:
    'Does the user ask for the reply to be spoken aloud (e.g. "read it to me", "say that out loud", "speak the answer")?',
  criteria: {
    true: 'The user explicitly asks to hear the reply spoken.',
    false: 'The user does not ask for the reply to be spoken.',
  },
};

/** Threshold on the noul probability — above it, the reply is spoken. */
export const SPEAK_INTENT_THRESHOLD = 0.6;

export function speakIntentFromNoul(noul: number): boolean {
  return Number.isFinite(noul) && noul >= SPEAK_INTENT_THRESHOLD;
}

/** System-prompt steer injected only when the user's prompt asked for speech. */
export const SPEAK_OVERRIDE_BLOCK = [
  'When you answer, the reply will be spoken aloud to the user.',
  'Write for the ear: no markdown, no code blocks, no URLs, no emoji.',
  'Keep it brief and conversational.',
].join(' ');
