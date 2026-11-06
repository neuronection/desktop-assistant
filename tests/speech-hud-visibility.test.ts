import { describe, it, expect } from 'vitest';
import { decideSpeechHudVisibility, type SpeechHudVisibilityInput } from '@shared/constants/window';
import type { LiveState } from '@shared/live';
import type { SpeechState } from '@shared/speech';

function input(patch: Partial<SpeechHudVisibilityInput> = {}): SpeechHudVisibilityInput {
  return {
    posture: 'auto',
    chatSurfaceVisible: false,
    speechState: 'idle',
    speechDismissed: false,
    liveState: 'idle',
    ...patch,
  };
}

describe('HUD visibility decision (plan 62)', () => {
  it('never shows the HUD beside a visible chat surface, even when pinned', () => {
    for (const posture of ['auto', 'pinned'] as const) {
      for (const speechState of ['idle', 'speaking'] as const) {
        for (const liveState of ['idle', 'listening'] as const) {
          expect(
            decideSpeechHudVisibility(input({ posture, speechState, liveState, chatSurfaceVisible: true })),
            `${posture}/${speechState}/${liveState}`
          ).toBe('hide');
        }
      }
    }
  });

  it('never shows the HUD under the never posture', () => {
    expect(decideSpeechHudVisibility(input({ posture: 'never', speechState: 'speaking' }))).toBe('hide');
    expect(decideSpeechHudVisibility(input({ posture: 'never', liveState: 'listening' }))).toBe('hide');
    expect(decideSpeechHudVisibility(input({ posture: 'never' }))).toBe('hide');
  });

  it('shows for every active live state, including error', () => {
    for (const liveState of ['arming', 'listening', 'transcribing', 'thinking', 'preparing', 'speaking', 'paused', 'error'] as LiveState[]) {
      expect(decideSpeechHudVisibility(input({ liveState })), liveState).toBe('show');
    }
  });

  it('shows an active speech utterance and hides a dismissed one', () => {
    for (const speechState of ['synthesizing', 'speaking', 'paused'] as SpeechState[]) {
      expect(decideSpeechHudVisibility(input({ speechState })), speechState).toBe('show');
      expect(decideSpeechHudVisibility(input({ speechState, speechDismissed: true })), speechState).toBe('hide');
    }
  });

  it('live outranks a dismissed speech utterance', () => {
    expect(
      decideSpeechHudVisibility(input({ speechState: 'speaking', speechDismissed: true, liveState: 'listening' }))
    ).toBe('show');
  });

  it('keeps the HUD up while it owns dictation or a HUD turn', () => {
    expect(decideSpeechHudVisibility(input({ hudBusy: true }))).toBe('show');
    expect(
      decideSpeechHudVisibility(input({ hudBusy: true, chatSurfaceVisible: true }))
    ).toBe('hide');
  });

  it('keeps a pinned idle HUD, fades auto, and fades a dismissed pinned one', () => {
    expect(decideSpeechHudVisibility(input({ posture: 'pinned' }))).toBe('show');
    expect(decideSpeechHudVisibility(input({ posture: 'pinned', speechDismissed: true }))).toBe('fade');
    expect(decideSpeechHudVisibility(input({ posture: 'auto' }))).toBe('fade');
    expect(decideSpeechHudVisibility(input({ posture: 'auto', speechDismissed: true }))).toBe('fade');
  });

  it('makes the card session-only even when pinned', () => {
    expect(decideSpeechHudVisibility(input({ posture: 'pinned', style: 'card' }))).toBe('fade');
    expect(decideSpeechHudVisibility(input({ posture: 'pinned', style: 'card', speechState: 'speaking' }))).toBe('show');
    expect(decideSpeechHudVisibility(input({ posture: 'pinned', style: 'card', liveState: 'listening' }))).toBe('show');
    for (const style of ['edge', 'dot'] as const) {
      expect(decideSpeechHudVisibility(input({ posture: 'pinned', style })), style).toBe('show');
    }
  });
});
