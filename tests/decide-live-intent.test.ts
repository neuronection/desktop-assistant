import { describe, it, expect, vi } from 'vitest';
import type { DecisionStatus } from '@main/ai/decide';
import {
  LIVE_INTENT_POINT,
  runLiveIntentPoint,
  type LiveIntentDeps,
  type LiveIntentInput,
} from '@main/ai/decide/points/live-intent';
import { LIVE_INTENT_QUESTION_ID } from '@shared/ai/live-intent';
import {
  classifyDeterministic,
  isEcho,
  matchEndKeyword,
  matchStopKeyword,
} from '@main/ai/live/filter';

function decided(choice: string, confidence = 0.9): DecisionStatus {
  return {
    status: 'decided',
    band: 'act',
    outcome: {
      engine: 'jev',
      calls: [],
      confidence,
      answers: {
        [LIVE_INTENT_QUESTION_ID]: { type: 'choice', choice, probabilities: {}, confidence },
      },
    },
  };
}

const speaking = 'the weather in Berlin is mild today';
const input = (transcript: string): LiveIntentInput => ({
  transcript,
  currentSentence: speaking,
});

describe('live-intent deterministic filter (plan 25 D15)', () => {
  it('recognizes end phrases and lets them beat stop phrases', () => {
    expect(matchEndKeyword('stop listening')).toBe(true);
    expect(matchEndKeyword('Goodbye!')).toBe(true);
    expect(matchEndKeyword("that's all")).toBe(true);
    expect(matchEndKeyword('stop')).toBe(false);
    expect(classifyDeterministic('stop listening', speaking)).toBe('end');
  });

  it('recognizes stop phrases only when the utterance is short', () => {
    expect(matchStopKeyword('stop')).toBe(true);
    expect(matchStopKeyword('please stop it')).toBe(true);
    expect(matchStopKeyword('stop by the store tomorrow')).toBe(false);
    expect(classifyDeterministic('wait a second', speaking)).toBe('interrupt');
  });

  it('treats near-identical or contained speech as echo, but not short or novel speech', () => {
    expect(isEcho(speaking, speaking)).toBe(true);
    expect(isEcho('the weather in Berlin', speaking)).toBe(true);
    expect(isEcho('yes', speaking)).toBe(false);
    expect(isEcho('what time is the meeting', speaking)).toBe(false);
    expect(classifyDeterministic(speaking, speaking)).toBe('ignore');
  });

  it('returns null for novel directed speech', () => {
    expect(classifyDeterministic('what is on my calendar', speaking)).toBeNull();
  });
});

describe('live-intent decision point (plan 25 D4)', () => {
  it('is a blocking post-response choice gate', () => {
    expect(LIVE_INTENT_POINT).toMatchObject({
      id: 'live-intent',
      capability: 'choice',
      phase: 'post-response',
      mode: 'blocking',
      domains: ['interrupt'],
    });
  });

  it('resolves keywords and echo without calling the engine', async () => {
    const run = vi.fn(async () => decided('interrupt'));
    const deps: LiveIntentDeps = { decision: { run } };
    expect(await runLiveIntentPoint(deps, input('stop'))).toMatchObject({
      intent: 'interrupt',
      source: 'keyword',
    });
    expect(await runLiveIntentPoint(deps, input('goodbye'))).toMatchObject({
      intent: 'end',
      source: 'keyword',
    });
    expect(await runLiveIntentPoint(deps, input(speaking))).toMatchObject({
      intent: 'ignore',
      source: 'echo',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('uses the engine verdict for novel speech above the confidence bar', async () => {
    const deps: LiveIntentDeps = { decision: { run: async () => decided('interrupt', 0.85) } };
    expect(await runLiveIntentPoint(deps, input('what is on my calendar'))).toMatchObject({
      intent: 'interrupt',
      source: 'engine',
      confidence: 0.85,
    });
  });

  it('fails closed on low confidence, with a higher bar for end', async () => {
    const lowInterrupt: LiveIntentDeps = { decision: { run: async () => decided('interrupt', 0.5) } };
    expect(await runLiveIntentPoint(lowInterrupt, input('what is on my calendar'))).toMatchObject({
      intent: 'ignore',
      source: 'engine',
    });
    const midEnd: LiveIntentDeps = { decision: { run: async () => decided('end', 0.7) } };
    expect(await runLiveIntentPoint(midEnd, input('what is on my calendar'))).toMatchObject({
      intent: 'ignore',
      source: 'engine',
    });
    const strongEnd: LiveIntentDeps = { decision: { run: async () => decided('end', 0.9) } };
    expect(await runLiveIntentPoint(strongEnd, input('what is on my calendar'))).toMatchObject({
      intent: 'end',
    });
  });

  it('fails open to ignore without an engine', async () => {
    expect(await runLiveIntentPoint({}, input('what is on my calendar'))).toEqual({
      intent: 'ignore',
      source: 'fallback',
    });
  });

  it('fails open to ignore on non-decided status, thrown errors, and unmatched answers', async () => {
    expect(
      await runLiveIntentPoint(
        { decision: { run: async () => ({ status: 'off' }) } },
        input('what is on my calendar')
      )
    ).toMatchObject({ intent: 'ignore', source: 'fallback' });
    expect(
      await runLiveIntentPoint(
        {
          decision: {
            run: async () => {
              throw new Error('engine down');
            },
          },
        },
        input('what is on my calendar')
      )
    ).toMatchObject({ intent: 'ignore', source: 'fallback' });
    expect(
      await runLiveIntentPoint(
        {
          decision: {
            run: async () => ({
              status: 'decided',
              band: 'act',
              outcome: { engine: 'jev', calls: [], confidence: 0.9 },
            }),
          },
        },
        input('what is on my calendar')
      )
    ).toMatchObject({ intent: 'ignore', source: 'fallback' });
  });

  it('passes the currently-playing sentence to the engine', async () => {
    const run = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('currently saying aloud');
      expect(prompt).toContain(speaking);
      return decided('ignore', 0.9);
    });
    await runLiveIntentPoint({ decision: { run } }, input('what is on my calendar'));
    expect(run).toHaveBeenCalledOnce();
  });
});
