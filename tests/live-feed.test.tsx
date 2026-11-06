// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SPEECH_INITIAL } from '@shared/speech';
import { LIVE_INITIAL, type LiveEvent, type LiveSnapshot } from '@shared/live';
import { SpeechOverlayApp } from '@renderer/speech-overlay-react/SpeechOverlayApp';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

function installApi(): {
  emitLive: (event: LiveEvent) => void;
  emitCaption: (payload: { session: number; seq: number; text: string; final: boolean }) => void;
} {
  const liveHandler = { current: null as ((event: LiveEvent) => void) | null };
  const captionHandler = {
    current: null as ((payload: { session: number; seq: number; text: string; final: boolean }) => void) | null,
  };
  const api = {
    getSpeechSnapshot: vi.fn(async () => SPEECH_INITIAL),
    getSpeechChunk: vi.fn(async () => null),
    onSpeechPlay: () => () => undefined,
    onSpeechStop: () => () => undefined,
    onSpeechState: () => () => undefined,
    controlSpeech: vi.fn(),
    getLiveState: vi.fn(async () => ({ ...LIVE_INITIAL })),
    onLiveEvent: (callback: (event: LiveEvent) => void) => {
      liveHandler.current = callback;
      return () => {
        liveHandler.current = null;
      };
    },
    onLiveCaption: (callback: (payload: { session: number; seq: number; text: string; final: boolean }) => void) => {
      captionHandler.current = callback;
      return () => {
        captionHandler.current = null;
      };
    },
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return {
    emitLive: (event) => act(() => liveHandler.current?.(event)),
    emitCaption: (payload) => act(() => captionHandler.current?.(payload)),
  };
}

function live(patch: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return { ...LIVE_INITIAL, session: 4, ...patch };
}

describe('live feed on the overlay (plan 63)', () => {
  it('shows the state, user transcript and reply caption; drops foreign sessions', () => {
    const { emitLive, emitCaption } = installApi();
    render(<SpeechOverlayApp controller={{ play: vi.fn(), stop: vi.fn(), setState: vi.fn() }} />);

    emitLive({ type: 'state', snapshot: live({ state: 'listening', capture: 'open' }) });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(TEXT.LIVE_HUD_LISTENING);

    emitLive({ type: 'transcript', text: 'what is on my calendar', final: true });
    expect(document.body.textContent).toContain('what is on my calendar');

    emitCaption({ session: 4, seq: 1, text: 'Your first meeting is at nine.', final: false });
    expect(document.body.textContent).toContain('Your first meeting is at nine.');

    emitCaption({ session: 99, seq: 1, text: 'stale session', final: false });
    expect(document.body.textContent).not.toContain('stale session');

    emitLive({ type: 'state', snapshot: live({ state: 'paused', reason: 'approval' }) });
    expect(document.querySelector('[role="status"]')?.textContent).toBe(TEXT.LIVE_HUD_APPROVAL);
  });

  it('clears captions when the session ends', () => {
    const { emitLive, emitCaption } = installApi();
    render(<SpeechOverlayApp controller={{ play: vi.fn(), stop: vi.fn(), setState: vi.fn() }} />);
    emitLive({ type: 'state', snapshot: live({ state: 'speaking', capture: 'closed' }) });
    emitCaption({ session: 4, seq: 2, text: 'A reply line.', final: true });
    expect(document.body.textContent).toContain('A reply line.');
    emitLive({ type: 'ended', reason: 'user', turns: 1 });
    expect(document.body.textContent).not.toContain('A reply line.');
  });
});
