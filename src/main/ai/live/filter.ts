/**
 * Deterministic pre-filter for live-intent (plan 25 D15/D16). Runs before
 * any decision engine: unambiguous stop/end phrases act immediately, and
 * echo of the sentence currently playing is ignored. Everything else is
 * left to the semantic layer (the `live-intent` decision point).
 *
 * Pure and i18n-anchored: the phrase lists are representative anchors,
 * not a checklist; unknown phrasings fall through to the engine.
 */

import type { LiveIntent } from '@shared/live';

const STOP_PHRASES: readonly string[] = [
  'stop',
  'stop it',
  'wait',
  'wait a moment',
  'hold on',
  'hold up',
  'hang on',
  'one moment',
  'just a moment',
  'just a second',
  'pause',
  'quiet',
  'be quiet',
  'shut up',
  'σταμάτα',
  'περίμενε',
  'para',
  'espera',
  'cállate',
  'stopp',
  'warte',
  'halte',
];

const END_PHRASES: readonly string[] = [
  'stop listening',
  'stop the conversation',
  'end the conversation',
  'end conversation',
  'end live',
  'exit live',
  'goodbye',
  'good bye',
  'bye',
  'bye bye',
  'that is all',
  "that's all",
  'we are done',
  "we're done",
  'i am done',
  "i'm done",
  'αντίο',
  'τέλος',
  'adiós',
  'hasta luego',
  'auf wiedersehen',
  'tschüss',
];

/** Extra tokens a phrase may carry and still be treated as that phrase. */
const MAX_EXTRA_TOKENS = 3;

export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalizeUtterance(text);
  return normalized ? normalized.split(' ') : [];
}

function phraseMatches(tokens: readonly string[], phrase: string): boolean {
  const wanted = tokenize(phrase);
  if (wanted.length === 0 || tokens.length === 0) {
    return false;
  }
  if (tokens.length > wanted.length + MAX_EXTRA_TOKENS) {
    return false;
  }
  for (let start = 0; start + wanted.length <= tokens.length; start += 1) {
    if (wanted.every((word, offset) => tokens[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

export function matchEndKeyword(text: string): boolean {
  const tokens = tokenize(text);
  return END_PHRASES.some((phrase) => phraseMatches(tokens, phrase));
}

export function matchStopKeyword(text: string): boolean {
  const tokens = tokenize(text);
  return STOP_PHRASES.some((phrase) => phraseMatches(tokens, phrase));
}

/** Fraction of the transcript's distinct tokens that also appear in the sentence. */
export function containmentIn(transcript: string, sentence: string): number {
  const left = new Set(tokenize(transcript));
  const right = new Set(tokenize(sentence));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / left.size;
}

/** Below this many tokens a transcript is too short to judge as echo. */
export const ECHO_MIN_TOKENS = 4;
export const ECHO_SIMILARITY_THRESHOLD = 0.8;

export function isEcho(transcript: string, currentSentence: string): boolean {
  if (!currentSentence.trim() || tokenize(transcript).length < ECHO_MIN_TOKENS) {
    return false;
  }
  return containmentIn(transcript, currentSentence) >= ECHO_SIMILARITY_THRESHOLD;
}

/**
 * The deterministic verdict, or `null` when the utterance needs the
 * semantic layer. End takes precedence over stop ("stop listening").
 */
export function classifyDeterministic(transcript: string, currentSentence: string): LiveIntent | null {
  if (matchEndKeyword(transcript)) {
    return 'end';
  }
  if (matchStopKeyword(transcript)) {
    return 'interrupt';
  }
  if (isEcho(transcript, currentSentence)) {
    return 'ignore';
  }
  return null;
}
