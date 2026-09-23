/**
 * Live conversation session (plan 25): the closed vocabulary and pure
 * reducer shared by both processes. Mirrors `shared/turns.ts` — main owns
 * the authoritative state; the renderer renders the latest snapshot and
 * never infers state from other events.
 *
 * The reducer is pure and idempotent: an action that does not match the
 * current state is ignored (the same snapshot is returned), never queued
 * into a bad transition. Capture is a derived dimension, not a state —
 * see `captureOf`.
 */

export type LiveState =
  | 'idle'
  | 'arming'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'error';

/** Whether the microphone is capturing right now. Derived, never set directly. */
export type LiveCapture = 'open' | 'closed';

/** The `live-intent` verdict for a detected utterance. */
export type LiveIntent = 'ignore' | 'interrupt' | 'end';

export type LiveEndReason =
  | 'user'
  | 'spoken'
  | 'window-hidden'
  | 'idle-timeout'
  | 'device-lost'
  | 'suspend'
  | 'quit'
  | 'error';

export type LiveNoticeCode =
  | 'mic_denied'
  | 'mic_lost'
  | 'stt_failed'
  | 'no_speech'
  | 'idle_timeout'
  | 'echo_detected'
  | 'barge_in_unavailable'
  | 'live_intent_failed'
  | 'tts_failed'
  | 'turn_failed'
  | 'provider_unavailable'
  | 'cost_cap';

export interface LiveSnapshot {
  state: LiveState;
  capture: LiveCapture;
  /** Full-duplex downgraded to half-duplex (echo control unavailable). */
  downgraded: boolean;
  /** Completed turns in this session (cost guard, plan 25 D14). */
  turns: number;
  /** A barge-in candidate is being classified (playback ducked). */
  candidate: boolean;
  /** Current-state qualifier, e.g. `approval` while paused. */
  reason?: string;
  /** Monotonic session generation; stale actions from a prior session are ignored. */
  session: number;
}

/**
 * Inputs to the reducer. `start`/`stop` bracket a session; the rest mirror
 * the renderer→main and main→renderer event flow.
 */
export type LiveAction =
  | { type: 'start' }
  | { type: 'stop'; reason: LiveEndReason }
  | { type: 'mic_ready' }
  | { type: 'speech_started' }
  | { type: 'phrase_committed' }
  | { type: 'transcript'; final: boolean }
  | { type: 'keep_listening' }
  | { type: 'turn_started' }
  | { type: 'turn_finished' }
  | { type: 'playback_started' }
  | { type: 'playback_ended' }
  | { type: 'speech_candidate' }
  | { type: 'live_intent'; intent: LiveIntent }
  | { type: 'interrupt' }
  | { type: 'approval_pending' }
  | { type: 'approval_resolved' }
  | { type: 'idle_timeout' }
  | { type: 'downgrade' }
  | { type: 'set_duplex'; fullDuplex: boolean }
  | { type: 'turn_failed' }
  | { type: 'error'; code: LiveNoticeCode };

/**
 * Main → renderer push (plan 25 IPC contract). `state` is authoritative
 * and monotonic; consumers render the latest and never infer state from
 * other events.
 */
export type LiveEvent =
  | { type: 'state'; snapshot: LiveSnapshot }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'duck'; on: boolean }
  | { type: 'intent'; intent: LiveIntent; engine?: string; text?: string }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; code: LiveNoticeCode }
  | { type: 'ended'; reason: LiveEndReason; turns: number };

export const LIVE_INITIAL: LiveSnapshot = {
  state: 'idle',
  capture: 'closed',
  downgraded: false,
  turns: 0,
  candidate: false,
  session: 0,
};

/** Stop a listening session after this long with no speech (plan 25 D9). */
export const LIVE_IDLE_TIMEOUT_MS = 60_000;

/**
 * Replies longer than this are not read aloud in live mode; a short
 * "shown on screen" notice is spoken instead (plan 25 D8).
 */
export const LIVE_SPOKEN_MAX_CHARS = 1200;

/**
 * Consecutive echo-ignored candidates that trigger an automatic
 * full-duplex → half-duplex downgrade (plan 25 D3/S4).
 */
export const LIVE_ECHO_DOWNGRADE_STREAK = 3;

/** Acoustic phrase gap in live mode — shorter than standard dictation (plan 25 S3). */
export const LIVE_PHRASE_GAP_MS_DEFAULT = 400;
export const STANDARD_PHRASE_GAP_MS_DEFAULT = 700;

/** Upper bound on a barge-in classification before it fails open to `ignore` (plan 25 S4). */
export const LIVE_INTENT_TIMEOUT_MS = 1500;

/**
 * Endpointing profile (plan 25 D5/S3): live mode ends a phrase sooner.
 * Falls back to the defaults for missing/invalid values.
 */
export function resolvePhraseGapMs(
  voice: { phraseGapMs?: number; livePhraseGapMs?: number } | undefined,
  live: boolean
): number {
  const pick = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  return live
    ? pick(voice?.livePhraseGapMs, LIVE_PHRASE_GAP_MS_DEFAULT)
    : pick(voice?.phraseGapMs, STANDARD_PHRASE_GAP_MS_DEFAULT);
}

/** The mic is open in `listening`/`transcribing`, and in `speaking` unless downgraded. */
export function captureOf(state: LiveState, downgraded: boolean): LiveCapture {
  switch (state) {
    case 'listening':
    case 'transcribing':
      return 'open';
    case 'speaking':
      return downgraded ? 'closed' : 'open';
    default:
      return 'closed';
  }
}

export function isLiveActive(state: LiveState): boolean {
  return state !== 'idle' && state !== 'error';
}

function transition(snapshot: LiveSnapshot, state: LiveState, patch: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    ...snapshot,
    ...patch,
    state,
    capture: captureOf(state, patch.downgraded ?? snapshot.downgraded),
  };
}

export function reduceLive(snapshot: LiveSnapshot, action: LiveAction): LiveSnapshot {
  switch (action.type) {
    case 'start':
      if (isLiveActive(snapshot.state)) {
        return snapshot;
      }
      return transition(snapshot, 'arming', {
        downgraded: false,
        turns: 0,
        candidate: false,
        reason: undefined,
        session: snapshot.session + 1,
      });

    case 'stop':
      if (snapshot.state === 'idle') {
        return snapshot;
      }
      return transition(snapshot, 'idle', {
        candidate: false,
        reason: action.reason,
      });

    case 'mic_ready':
      if (snapshot.state === 'arming' || snapshot.state === 'error') {
        return transition(snapshot, 'listening', { reason: undefined });
      }
      return snapshot;

    case 'speech_started':
    case 'transcript':
    case 'turn_finished':
      return snapshot;

    case 'turn_failed':
      if (snapshot.state === 'thinking' || snapshot.state === 'speaking') {
        return transition(snapshot, 'listening', { candidate: false });
      }
      return snapshot;

    case 'phrase_committed':
      return snapshot.state === 'listening' ? transition(snapshot, 'transcribing') : snapshot;

    case 'keep_listening':
      return snapshot.state === 'transcribing' ? transition(snapshot, 'listening') : snapshot;

    case 'turn_started':
      if (snapshot.state === 'transcribing' || snapshot.state === 'listening') {
        return transition(snapshot, 'thinking', { turns: snapshot.turns + 1 });
      }
      return snapshot;

    case 'playback_started':
      return snapshot.state === 'thinking' ? transition(snapshot, 'speaking') : snapshot;

    case 'playback_ended':
      if (snapshot.state === 'speaking' || snapshot.state === 'thinking') {
        return transition(snapshot, 'listening', { candidate: false });
      }
      return snapshot;

    case 'speech_candidate':
      if (snapshot.state === 'speaking' && snapshot.capture === 'open') {
        return { ...snapshot, candidate: true };
      }
      return snapshot;

    case 'live_intent':
      if (action.intent === 'end') {
        return isLiveActive(snapshot.state)
          ? transition(snapshot, 'idle', { candidate: false, reason: 'spoken' })
          : snapshot;
      }
      if (snapshot.state !== 'speaking') {
        return snapshot;
      }
      if (action.intent === 'ignore') {
        return { ...snapshot, candidate: false };
      }
      return transition(snapshot, 'listening', { candidate: false });

    case 'interrupt':
      return snapshot.state === 'speaking'
        ? transition(snapshot, 'listening', { candidate: false })
        : snapshot;

    case 'approval_pending':
      if (snapshot.state === 'thinking' || snapshot.state === 'transcribing') {
        return transition(snapshot, 'paused', { reason: 'approval', candidate: false });
      }
      return snapshot;

    case 'approval_resolved':
      return snapshot.state === 'paused'
        ? transition(snapshot, 'thinking', { reason: undefined })
        : snapshot;

    case 'idle_timeout':
      return snapshot.state === 'listening'
        ? transition(snapshot, 'idle', { reason: 'idle-timeout' })
        : snapshot;

    case 'downgrade':
      if (snapshot.downgraded) {
        return snapshot;
      }
      return transition(snapshot, snapshot.state, { downgraded: true });

    case 'set_duplex':
      if (!isLiveActive(snapshot.state) || snapshot.downgraded === !action.fullDuplex) {
        return snapshot;
      }
      return transition(snapshot, snapshot.state, { downgraded: !action.fullDuplex });

    case 'error':
      return transition(snapshot, 'error', { candidate: false, reason: action.code });
  }
}
