import { describe, it, expect } from 'vitest';
import {
  LIVE_INITIAL,
  captureOf,
  isLiveActive,
  reduceLive,
  type LiveAction,
  type LiveSnapshot,
} from '@shared/live';

function run(actions: LiveAction[], from: LiveSnapshot = LIVE_INITIAL): LiveSnapshot {
  return actions.reduce(reduceLive, from);
}

function activeAt(state: LiveSnapshot['state'], patch: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const base = run([{ type: 'start' }, { type: 'mic_ready' }]);
  return { ...base, state, capture: captureOf(state, patch.downgraded ?? base.downgraded), ...patch };
}

describe('live capture derivation (plan 25 D2)', () => {
  it('opens capture in listening/transcribing/preparing and in speaking when full-duplex', () => {
    expect(captureOf('listening', false)).toBe('open');
    expect(captureOf('transcribing', false)).toBe('open');
    expect(captureOf('preparing', false)).toBe('open');
    expect(captureOf('preparing', true)).toBe('open');
    expect(captureOf('speaking', false)).toBe('open');
  });

  it('closes capture in speaking once downgraded, and in non-capture states', () => {
    expect(captureOf('speaking', true)).toBe('closed');
    expect(captureOf('thinking', false)).toBe('closed');
    expect(captureOf('paused', false)).toBe('closed');
    expect(captureOf('idle', false)).toBe('closed');
    expect(captureOf('error', false)).toBe('closed');
  });
});

describe('live reducer — session lifecycle', () => {
  it('starts from idle into arming and resets per-session counters', () => {
    const started = run([{ type: 'start' }]);
    expect(started).toMatchObject({ state: 'arming', capture: 'closed', turns: 0, session: 1 });
    expect(isLiveActive(started.state)).toBe(true);
  });

  it('is idempotent: start while active is a no-op', () => {
    const listening = run([{ type: 'start' }, { type: 'mic_ready' }]);
    expect(reduceLive(listening, { type: 'start' })).toBe(listening);
  });

  it('starts from error (restart after a failure)', () => {
    const errored = run([{ type: 'start' }, { type: 'error', code: 'turn_failed' }]);
    expect(errored.state).toBe('error');
    const restarted = reduceLive(errored, { type: 'start' });
    expect(restarted.state).toBe('arming');
    expect(restarted.session).toBe(2);
  });

  it('stops from any active state and is a no-op when idle', () => {
    const speaking = activeAt('speaking');
    const stopped = reduceLive(speaking, { type: 'stop', reason: 'user' });
    expect(stopped).toMatchObject({ state: 'idle', capture: 'closed', candidate: false });
    expect(reduceLive(LIVE_INITIAL, { type: 'stop', reason: 'user' })).toBe(LIVE_INITIAL);
  });

  it('recovers from error to listening on mic_ready', () => {
    const errored = run([{ type: 'start' }, { type: 'error', code: 'stt_failed' }]);
    expect(reduceLive(errored, { type: 'mic_ready' }).state).toBe('listening');
  });
});

describe('live reducer — turn loop', () => {
  it('walks arming → listening → transcribing → thinking → speaking → listening', () => {
    let snap = run([{ type: 'start' }]);
    expect(snap.state).toBe('arming');
    snap = reduceLive(snap, { type: 'mic_ready' });
    expect(snap).toMatchObject({ state: 'listening', capture: 'open' });
    snap = reduceLive(snap, { type: 'phrase_committed' });
    expect(snap).toMatchObject({ state: 'transcribing', capture: 'open' });
    snap = reduceLive(snap, { type: 'turn_started' });
    expect(snap).toMatchObject({ state: 'thinking', capture: 'closed', turns: 1 });
    snap = reduceLive(snap, { type: 'playback_started' });
    expect(snap).toMatchObject({ state: 'speaking', capture: 'open' });
    snap = reduceLive(snap, { type: 'playback_ended' });
    expect(snap).toMatchObject({ state: 'listening', capture: 'open' });
  });

  it('returns to listening when the gate keeps listening', () => {
    const transcribing = run([{ type: 'start' }, { type: 'mic_ready' }, { type: 'phrase_committed' }]);
    expect(reduceLive(transcribing, { type: 'keep_listening' }).state).toBe('listening');
  });

  it('treats an empty playback (no TTS) as draining straight to listening', () => {
    const thinking = run([
      { type: 'start' },
      { type: 'mic_ready' },
      { type: 'phrase_committed' },
      { type: 'turn_started' },
    ]);
    expect(reduceLive(thinking, { type: 'playback_ended' }).state).toBe('listening');
  });

  it('accepts a direct send while listening, ignores turn actions elsewhere', () => {
    expect(reduceLive(activeAt('listening'), { type: 'turn_started' }).state).toBe('thinking');
    const speaking = activeAt('speaking');
    expect(reduceLive(speaking, { type: 'turn_started' })).toBe(speaking);
    expect(reduceLive(speaking, { type: 'playback_ended' })).not.toBe(speaking);
    const transcribing = activeAt('transcribing');
    expect(reduceLive(transcribing, { type: 'turn_started' })).not.toBe(transcribing);
  });

  it('does not move on no-op observation actions', () => {
    const listening = activeAt('listening');
    expect(reduceLive(listening, { type: 'speech_started' })).toBe(listening);
    expect(reduceLive(listening, { type: 'transcript', final: true })).toBe(listening);
  });

  it('opens capture while preparing audio, and arms barge-in there', () => {
    const thinking = run([
      { type: 'start' },
      { type: 'mic_ready' },
      { type: 'phrase_committed' },
      { type: 'turn_started' },
    ]);
    const preparing = reduceLive(thinking, { type: 'turn_finished' });
    expect(preparing).toMatchObject({ state: 'preparing', capture: 'open' });
    const ducked = reduceLive(preparing, { type: 'speech_candidate' });
    expect(ducked.candidate).toBe(true);
    expect(reduceLive(ducked, { type: 'live_intent', intent: 'interrupt' })).toMatchObject({
      state: 'listening',
      capture: 'open',
    });
    expect(reduceLive(preparing, { type: 'playback_started' })).toMatchObject({ state: 'speaking' });
    expect(reduceLive(preparing, { type: 'interrupt' })).toMatchObject({ state: 'listening' });
  });
});

describe('live reducer — barge-in (plan 25 D4/D16)', () => {
  it('arms a candidate only while speaking with capture open', () => {
    const speaking = activeAt('speaking');
    expect(reduceLive(speaking, { type: 'speech_candidate' }).candidate).toBe(true);
    const downgraded = { ...activeAt('speaking'), downgraded: true, capture: 'closed' as const };
    expect(reduceLive(downgraded, { type: 'speech_candidate' })).toBe(downgraded);
    expect(reduceLive(activeAt('listening'), { type: 'speech_candidate' }).candidate).toBe(false);
  });

  it('ignore clears the candidate and keeps playing', () => {
    const ducked = reduceLive(activeAt('speaking'), { type: 'speech_candidate' });
    const ignored = reduceLive(ducked, { type: 'live_intent', intent: 'ignore' });
    expect(ignored).toMatchObject({ state: 'speaking', candidate: false });
  });

  it('interrupt stops playback and resumes listening', () => {
    const ducked = reduceLive(activeAt('speaking'), { type: 'speech_candidate' });
    const interrupted = reduceLive(ducked, { type: 'live_intent', intent: 'interrupt' });
    expect(interrupted).toMatchObject({ state: 'listening', capture: 'open', candidate: false });
  });

  it('user interrupt stops the reply without sending', () => {
    expect(reduceLive(activeAt('speaking'), { type: 'interrupt' }).state).toBe('listening');
    expect(reduceLive(activeAt('listening'), { type: 'interrupt' })).toEqual(activeAt('listening'));
  });

  it('end intent works while speaking and while listening', () => {
    expect(reduceLive(activeAt('speaking'), { type: 'live_intent', intent: 'end' })).toMatchObject({
      state: 'idle',
      reason: 'spoken',
    });
    expect(reduceLive(activeAt('listening'), { type: 'live_intent', intent: 'end' }).state).toBe('idle');
    expect(reduceLive(LIVE_INITIAL, { type: 'live_intent', intent: 'end' })).toBe(LIVE_INITIAL);
  });

  it('ignores interrupt/ignore verdicts outside speaking', () => {
    const listening = activeAt('listening');
    expect(reduceLive(listening, { type: 'live_intent', intent: 'interrupt' })).toBe(listening);
    expect(reduceLive(listening, { type: 'live_intent', intent: 'ignore' })).toBe(listening);
  });
});

describe('live reducer — approvals, timeout, downgrade, errors', () => {
  it('pauses for approval with capture closed and resumes to thinking', () => {
    const thinking = activeAt('thinking');
    const paused = reduceLive(thinking, { type: 'approval_pending' });
    expect(paused).toMatchObject({ state: 'paused', capture: 'closed', reason: 'approval' });
    expect(reduceLive(paused, { type: 'approval_resolved' })).toMatchObject({
      state: 'thinking',
      reason: undefined,
    });
  });

  it('does not pause outside a turn', () => {
    const listening = activeAt('listening');
    expect(reduceLive(listening, { type: 'approval_pending' })).toBe(listening);
  });

  it('times out only while listening', () => {
    expect(reduceLive(activeAt('listening'), { type: 'idle_timeout' })).toMatchObject({
      state: 'idle',
      reason: 'idle-timeout',
    });
    const speaking = activeAt('speaking');
    expect(reduceLive(speaking, { type: 'idle_timeout' })).toBe(speaking);
  });

  it('downgrade closes capture while speaking and is idempotent', () => {
    const speaking = activeAt('speaking');
    const downgraded = reduceLive(speaking, { type: 'downgrade' });
    expect(downgraded).toMatchObject({ state: 'speaking', capture: 'closed', downgraded: true });
    expect(reduceLive(downgraded, { type: 'downgrade' })).toBe(downgraded);
  });

  it('toggles duplex both ways while active', () => {
    const speaking = activeAt('speaking');
    const half = reduceLive(speaking, { type: 'set_duplex', fullDuplex: false });
    expect(half).toMatchObject({ downgraded: true, capture: 'closed' });
    const full = reduceLive(half, { type: 'set_duplex', fullDuplex: true });
    expect(full).toMatchObject({ downgraded: false, capture: 'open' });
    expect(reduceLive(full, { type: 'set_duplex', fullDuplex: true })).toBe(full);
    expect(reduceLive(LIVE_INITIAL, { type: 'set_duplex', fullDuplex: false })).toBe(LIVE_INITIAL);
  });

  it('errors from any active state with the code as reason', () => {
    const errored = reduceLive(activeAt('speaking'), { type: 'error', code: 'mic_lost' });
    expect(errored).toMatchObject({ state: 'error', capture: 'closed', reason: 'mic_lost' });
  });
});
