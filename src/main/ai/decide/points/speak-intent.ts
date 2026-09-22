import type { DecisionQuestion } from '@shared/ai/decisions';
import type { DecisionPointDescriptor } from '@shared/ai/decision-points';
import { SPEAK_INTENT_QUESTION, SPEAK_INTENT_QUESTION_ID, speakIntentFromNoul } from '@shared/ai/speak-intent';
import type { DecisionStatus } from '../index';

export { SPEAK_OVERRIDE_BLOCK } from '@shared/ai/speak-intent';

export interface SpeakIntentDecision {
  run(input: string, questions: DecisionQuestion[]): Promise<DecisionStatus>;
}

/**
 * The prompt-armed speak gate (plan 24 S5): a pre-model `noul` over the
 * user's own input, run in the same batch as tool dispatch. The verdict
 * only arms a per-turn speak override — it never blocks or shapes the
 * model call, and a model reply can never arm it (D13).
 */
export const SPEAK_INTENT_POINT: DecisionPointDescriptor = {
  id: 'speak-intent',
  capability: 'boolean-gate',
  phase: 'pre-model',
  mode: 'advisory',
  domains: ['speak'],
};

export interface SpeakIntentVerdict {
  speak: boolean;
}

export async function runSpeakIntentPoint(
  decision: SpeakIntentDecision | undefined,
  input: string
): Promise<SpeakIntentVerdict | null> {
  if (!decision) {
    return null;
  }
  try {
    const status = await decision.run(input, [SPEAK_INTENT_QUESTION]);
    if (status.status !== 'decided') {
      return null;
    }
    const answer = status.outcome.answers?.[SPEAK_INTENT_QUESTION_ID];
    if (!answer || answer.type !== 'noul') {
      return null;
    }
    return { speak: speakIntentFromNoul(answer.noul) };
  } catch (error) {
    console.log(`[decision] speak-intent point failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
    return null;
  }
}
