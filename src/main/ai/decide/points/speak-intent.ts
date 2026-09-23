import type { DecisionQuestion } from '@shared/ai/decisions';
import type { DecisionPointDescriptor } from '@shared/ai/decision-points';
import {
  SPEAK_INTENT_QUESTION,
  SPEAK_INTENT_QUESTION_ID,
  SPEAK_MODE_QUESTION,
  SPEAK_MODE_QUESTION_ID,
  speakIntentFromNoul,
  speakModeFromChoice,
  type SpeakModeIntent,
} from '@shared/ai/speak-intent';
import type { DecisionStatus } from '../index';

export { SPEAK_OVERRIDE_BLOCK } from '@shared/ai/speak-intent';

export interface SpeakIntentDecision {
  run(input: string, questions: DecisionQuestion[]): Promise<DecisionStatus>;
}

/**
 * The prompt-armed speak gate (plan 24 S5): a pre-model gate over the
 * user's own input, run in the same batch as tool dispatch. The verdict
 * only arms a per-turn speak override plus an optional standing voice mode —
 * it never blocks or shapes the model call, and a model reply can never arm
 * it (D13).
 */
export const SPEAK_INTENT_POINT: DecisionPointDescriptor = {
  id: 'speak-intent',
  capability: 'boolean-gate',
  phase: 'pre-model',
  mode: 'advisory',
  domains: ['speak'],
};

export interface SpeakIntentVerdict {
  /** Speak this reply. */
  speak: boolean;
  /** Standing voice mode: arm, clear, or leave unchanged. */
  mode: SpeakModeIntent;
}

export async function runSpeakIntentPoint(
  decision: SpeakIntentDecision | undefined,
  input: string
): Promise<SpeakIntentVerdict | null> {
  if (!decision) {
    return null;
  }
  try {
    // Both questions ride one speculative call (plan 24 S5 follow-up).
    const status = await decision.run(input, [SPEAK_INTENT_QUESTION, SPEAK_MODE_QUESTION]);
    if (status.status !== 'decided') {
      return null;
    }
    const perReply = status.outcome.answers?.[SPEAK_INTENT_QUESTION_ID];
    const modeAnswer = status.outcome.answers?.[SPEAK_MODE_QUESTION_ID];
    const mode = modeAnswer?.type === 'choice' ? speakModeFromChoice(modeAnswer.choice) : 'none';
    const speak = perReply?.type === 'noul' ? speakIntentFromNoul(perReply.noul) : false;
    // A mode request implies speaking from this reply onward.
    return { speak: speak || mode === 'on', mode };
  } catch (error) {
    console.log(`[decision] speak-intent point failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
    return null;
  }
}
