import { describe, it, expect, vi } from 'vitest';
import type { DecisionStatus } from '@main/ai/decide';
import {
  runUtteranceGate,
  UTTERANCE_COMPLETE_QUESTION_ID,
  UTTERANCE_GATE_POINT,
  type UtteranceGateDeps,
} from '@main/ai/decide/points/utterance-gate';
import { FAIL_VERDICT } from '@main/ai/utterance';

function decided(noul: number): DecisionStatus {
  return {
    status: 'decided',
    band: 'act',
    outcome: {
      engine: 'jev',
      calls: [],
      confidence: 0.9,
      answers: { [UTTERANCE_COMPLETE_QUESTION_ID]: { type: 'noul', noul } },
    },
  };
}

const request = { text: 'what is the weather in Berlin', wantsText: false };

describe('utterance-gate decision point (plan 24 S6)', () => {
  it('is a blocking pre-input gate owning the gate domain', () => {
    expect(UTTERANCE_GATE_POINT).toMatchObject({
      id: 'utterance-gate',
      capability: 'boolean-gate',
      phase: 'pre-input',
      mode: 'blocking',
      domains: ['gate'],
    });
  });

  it('decides complete via the engine when at/above threshold (no fallback call)', async () => {
    const evaluate = vi.fn(async () => ({ complete: false }));
    const deps: UtteranceGateDeps = { decision: { run: async () => decided(0.85) }, evaluate };
    expect(await runUtteranceGate(deps, request)).toEqual({ complete: true });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('decides incomplete below threshold', async () => {
    const evaluate = vi.fn(async () => ({ complete: true }));
    const deps: UtteranceGateDeps = { decision: { run: async () => decided(0.4) }, evaluate };
    expect(await runUtteranceGate(deps, request)).toEqual({ complete: false });
  });

  it('uses the fallback for corrected text when correction is requested and complete', async () => {
    const evaluate = vi.fn(async () => ({ complete: true, text: 'What is the weather in Berlin?' }));
    const deps: UtteranceGateDeps = { decision: { run: async () => decided(0.9) }, evaluate };
    expect(await runUtteranceGate(deps, { ...request, wantsText: true })).toEqual({
      complete: true,
      text: 'What is the weather in Berlin?',
    });
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it('falls back to the evaluator when no engine is wired', async () => {
    const evaluate = vi.fn(async () => ({ complete: true }));
    expect(await runUtteranceGate({ evaluate }, request)).toEqual({ complete: true });
  });

  it('fails closed on engine non-decided, thrown errors, or unmatched answers', async () => {
    const evaluate = vi.fn(async () => FAIL_VERDICT);
    expect(
      await runUtteranceGate({ decision: { run: async () => ({ status: 'off' }) }, evaluate }, request)
    ).toEqual(FAIL_VERDICT);
    expect(
      await runUtteranceGate(
        {
          decision: {
            run: async () => {
              throw new Error('down');
            },
          },
          evaluate,
        },
        request
      )
    ).toEqual(FAIL_VERDICT);
    expect(evaluate).toHaveBeenCalled();
  });

  it('falls back when the engine returns no usable noul answer', async () => {
    const evaluate = vi.fn(async () => ({ complete: true }));
    const deps: UtteranceGateDeps = {
      decision: { run: async () => ({ status: 'decided', band: 'act', outcome: { engine: 'jev', calls: [], confidence: 0.9 } }) },
      evaluate,
    };
    expect(await runUtteranceGate(deps, request)).toEqual({ complete: true });
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
