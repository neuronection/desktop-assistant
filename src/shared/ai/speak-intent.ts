/**
 * Prompt-armed auto-speak (plan 24 S5): the user's own prompt decides
 * whether a reply is spoken. The judgment belongs to a decision engine
 * (a `noul` over the user's input in the pre-model batch); the model's
 * reply can never arm a side effect — the injection guard (D13).
 */

import type { DecisionQuestion } from './decisions';

export const SPEAK_INTENT_QUESTION_ID = '__speak__';
export const SPEAK_MODE_QUESTION_ID = '__speak_mode__';

/**
 * The one noul question the pre-model batch asks. The engine may judge in
 * any language; the examples span the common phrasing families (imperative,
 * device/assistant framing, TTS nouns, accessibility) and a few non-English
 * anchors — they are representative anchors, not a checklist.
 */
export const SPEAK_INTENT_QUESTION = {
  id: SPEAK_INTENT_QUESTION_ID,
  type: 'noul' as const,
  instructions: [
    'Does the user ask for THIS reply to be spoken aloud?',
    'Examples of yes: "read it to me", "read this aloud", "say that out loud", "out loud please",',
    '"speak your answer", "answer out loud", "voice reply", "talk to me", "use text to speech",',
    '"in voice mode", "narrate it", "I am driving so read it to me",',
    '"διάβασέ το", "πες το δυνατά", "léelo en voz alta", "lies es vor".',
  ].join(' '),
  criteria: {
    true: 'The user explicitly asks for this reply to be spoken/heard aloud (possibly in another language).',
    false:
      'The user does not ask for this reply to be spoken. Mentioning speaking, reading aloud, voice, text-to-speech, or audio as a topic — or asking to read a document/file ("read this file", "what does this say?") — is not a request for this reply to be spoken.',
  },
};

/**
 * The standing-voice-mode question: does the user want every following
 * reply spoken (a mode), stop it, or neither? Asked in the same speculative
 * call as the per-reply question. A `choice` so "stop speaking" can clear
 * the mode in the same turn.
 */
export const SPEAK_MODE_QUESTION: DecisionQuestion = {
  id: SPEAK_MODE_QUESTION_ID,
  type: 'choice',
  instructions: [
    'Does the user ask for a standing voice mode for this conversation?',
    '"from now on speak aloud", "always read your answers", "keep talking to me" mean: on.',
    '"stop speaking", "no more voice", "stop reading aloud", "be quiet now" mean: off.',
    'Anything else means: none.',
  ].join(' '),
  options: {
    on: 'The user wants every following reply spoken aloud.',
    off: 'The user wants spoken replies to stop.',
    none: 'The user says nothing about a standing voice mode.',
  },
};

export type SpeakModeIntent = 'on' | 'off' | 'none';

/** Read the mode choice from answers, tolerating unknown/missing values. */
export function speakModeFromChoice(choice: unknown): SpeakModeIntent {
  return choice === 'on' || choice === 'off' || choice === 'none' ? choice : 'none';
}

/** Threshold on the noul probability — above it, the reply is spoken. */
export const SPEAK_INTENT_THRESHOLD = 0.6;

export function speakIntentFromNoul(noul: number): boolean {
  return Number.isFinite(noul) && noul >= SPEAK_INTENT_THRESHOLD;
}

/** System-prompt steer injected only when the user's prompt asked for speech. */
export const SPEAK_OVERRIDE_BLOCK = [
  'When you answer, the reply will be spoken aloud to the user.',
  'Write for the ear: no markdown, no code blocks, no URLs, no emoji, no lists or tables.',
  'Spell out numbers, units, and abbreviations the way they are said.',
  'Keep it brief and conversational.',
].join(' ');
