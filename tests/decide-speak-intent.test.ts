import { describe, it, expect } from 'vitest';
import type { DecisionStatus } from '@main/ai/decide';
import { runSpeakIntentPoint, SPEAK_INTENT_POINT } from '@main/ai/decide/points/speak-intent';
import {
  SPEAK_INTENT_QUESTION,
  SPEAK_INTENT_QUESTION_ID,
  SPEAK_OVERRIDE_BLOCK,
  speakIntentFromNoul,
} from '@shared/ai/speak-intent';

function decided(noul: number): DecisionStatus {
  return {
    status: 'decided',
    band: 'act',
    outcome: { engine: 'jev', calls: [], confidence: 0.9, answers: { [SPEAK_INTENT_QUESTION_ID]: { type: 'noul', noul } } },
  };
}

describe('speak-intent decision point (plan 24 S5)', () => {
  it('is an advisory pre-model gate owning the speak domain', () => {
    expect(SPEAK_INTENT_POINT).toMatchObject({
      id: 'speak-intent',
      capability: 'boolean-gate',
      phase: 'pre-model',
      mode: 'advisory',
      domains: ['speak'],
    });
  });

  it('arms when the noul is at or above the threshold', async () => {
    const run = async () => decided(0.82);
    expect(await runSpeakIntentPoint({ run }, 'read it to me')).toEqual({ speak: true });
  });

  it('does not arm below the threshold', async () => {
    const run = async () => decided(0.2);
    expect(await runSpeakIntentPoint({ run }, 'what is the capital of France')).toEqual({ speak: false });
  });

  it('returns null when no engine is wired or the status is not decided', async () => {
    expect(await runSpeakIntentPoint(undefined, 'x')).toBeNull();
    expect(await runSpeakIntentPoint({ run: async () => ({ status: 'off' }) }, 'x')).toBeNull();
    expect(await runSpeakIntentPoint({ run: async () => ({ status: 'error', reason: 'down' }) }, 'x')).toBeNull();
  });

  it('fails soft when the engine throws', async () => {
    const run = async () => {
      throw new Error('boom');
    };
    expect(await runSpeakIntentPoint({ run }, 'x')).toBeNull();
  });

  it('ignores non-noul or missing answers', async () => {
    const run = async (): Promise<DecisionStatus> => ({
      status: 'decided',
      band: 'act',
      outcome: { engine: 'jev', calls: [], confidence: 0.9 },
    });
    expect(await runSpeakIntentPoint({ run }, 'x')).toBeNull();
  });

  it('thresholds the noul probability', () => {
    expect(speakIntentFromNoul(0.6)).toBe(true);
    expect(speakIntentFromNoul(0.59)).toBe(false);
    expect(speakIntentFromNoul(Number.NaN)).toBe(false);
  });
});

describe('prompt-armed overwrite block', () => {
  it('instructs the model to write for the ear', () => {
    expect(SPEAK_OVERRIDE_BLOCK).toMatch(/spoken aloud/i);
    expect(SPEAK_OVERRIDE_BLOCK).toMatch(/no markdown/i);
    expect(SPEAK_OVERRIDE_BLOCK).toMatch(/no lists or tables/i);
    expect(SPEAK_OVERRIDE_BLOCK).toMatch(/spell out numbers/i);
  });
});

describe('speak-intent question phrasing', () => {
  it('spans phrasing families and keeps a false guard against topic mentions', () => {
    const instructions = SPEAK_INTENT_QUESTION.instructions;
    const falseCriteria = SPEAK_INTENT_QUESTION.criteria.false;
    // phrasing families: imperative, device framing, TTS noun, accessibility, non-English
    expect(instructions).toMatch(/read it to me/i);
    expect(instructions).toMatch(/answer out loud/i);
    expect(instructions).toMatch(/text to speech/i);
    expect(instructions).toMatch(/driving/i);
    expect(instructions).toMatch(/διάβασέ το|voz alta|vor/i);
    // the bigger risk is over-arming: a topic mention must not count.
    expect(falseCriteria).toMatch(/topic/i);
    expect(falseCriteria).toMatch(/read this file/i);
  });
});
