/**
 * Speech bus (plan 58): the closed vocabulary and pure reducer shared by both
 * processes. Mirrors `shared/live.ts` — main owns the authoritative state; the
 * overlay and the launcher render the latest snapshot and never infer state
 * from other events.
 *
 * The reducer is pure and idempotent: an action that does not apply to the
 * current state returns the same snapshot (never queued into a bad
 * transition). Playback facts carrying another utterance id are dropped —
 * a recreated overlay cannot revive a prior utterance.
 */

export const SPEECH_STATES = ['idle', 'synthesizing', 'speaking', 'paused'] as const;

export const SPEECH_SOURCES = ['selection', 'reply', 'replay', 'clipboard', 'preview'] as const;

/** Sources a renderer may request over `speech:speak`; `preview` is settings-only. */
export const SPEECH_REQUEST_SOURCES = ['selection', 'reply', 'replay', 'clipboard'] as const;

export const SPEECH_CONTROLS = ['pause', 'resume', 'stop', 'dismiss'] as const;

export const SPEECH_PLAYBACK_FACTS = ['chunk_started', 'ended', 'error'] as const;

export const SPEECH_HUD_POSTURES = ['auto', 'pinned', 'never'] as const;

export const SPEECH_HUD_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const;

export const SPEECH_CACHE_SCHEME = 'speech-cache';

export const SPEECH_CACHE_HOST = 'chunk';

export function speechCacheUrl(fileName: string): string {
  return `${SPEECH_CACHE_SCHEME}://${SPEECH_CACHE_HOST}/${fileName}`;
}

export interface SpeechCacheStats {
  /** The cache setting is on. */
  enabled: boolean;
  /** The cache directory is usable for this session. */
  available: boolean;
  utterances: number;
  bytes: number;
}

export const SPEECH_NOTICE_CODES = [
  'no_selection',
  'selection_unsupported',
  'too_long',
  'no_tts_assignment',
  'live_busy',
  'provider_error',
  'playback_failed',
  'overlay_unavailable',
  'hotkey_unavailable',
] as const;

export type SpeechNoticeCode = (typeof SPEECH_NOTICE_CODES)[number];

export interface SpeechNotice {
  code: SpeechNoticeCode;
  /** Short provider/playback detail (already compacted, never key material). */
  detail?: string;
  /** The configured selection limit, for `too_long`. */
  limit?: number;
}

export interface SpeechRequest {
  text: string;
  source: SpeechSource;
  /** Collapses a reply spoken by two windows into one utterance (2 s window). */
  dedupeKey?: string;
}

/** Settings audition: the draft voice/speed, never persisted by this call. */
export interface SpeechPreviewRequest {
  voice?: string;
  speed?: number;
}

export type SpeechSpeakOutcome =
  | 'started'
  | 'queued'
  | 'replaced'
  | 'duplicate'
  | 'live_busy'
  | 'ignored';

/** One chunk the overlay must play (cache-hit URL or ephemeral data URL). */
export interface SpeechPlayInstruction {
  utteranceId: number;
  chunkIndex: number;
  url: string;
}

export interface SpeechHistoryEntry {
  utteranceId: number;
  source: SpeechSource;
  /** Whitespace-collapsed head of the spoken text (never persisted). */
  preview: string;
  at: number;
  chunks: number;
  cached: number;
  synthesisCalls: number;
}

export type SpeechState = (typeof SPEECH_STATES)[number];

export type SpeechSource = (typeof SPEECH_SOURCES)[number];

export type SpeechControl = (typeof SPEECH_CONTROLS)[number];

export type SpeechPlaybackFactKind = (typeof SPEECH_PLAYBACK_FACTS)[number];

export type SpeechHudPosture = (typeof SPEECH_HUD_POSTURES)[number];

export type SpeechHudCorner = (typeof SPEECH_HUD_CORNERS)[number];

/** A playback fact reported by the overlay (and main's own terminal failures). */
export interface SpeechPlaybackFact {
  /** Utterance the fact belongs to; facts for any other id are stale. */
  utteranceId: number;
  /** Zero-based chunk the fact is about. */
  chunkIndex: number;
  fact: SpeechPlaybackFactKind;
  /** Short error text for the HUD flash. */
  detail?: string;
}

/** Main → renderer push (`speech:state`). Authoritative and monotonic. */
export interface SpeechSnapshot {
  state: SpeechState;
  source: SpeechSource | null;
  /** Monotonic per-process utterance id (counter + boot epoch), never `Date.now()`. */
  utteranceId: number;
  /** Zero-based chunk the bus is playing or preparing. */
  chunkIndex: number;
  chunkCount: number;
  /** Current chunk text — the HUD's primary line. */
  chunkText: string;
  /** Where a paused utterance resumes; `null` while not paused. */
  resumeTo: 'synthesizing' | 'speaking' | null;
  /** HUD dismissed for this utterance (pinned demotes to auto for the session). */
  dismissed: boolean;
  /** Short error text for the HUD error flash; cleared by the next start. */
  lastError: string | null;
}

export type SpeechAction =
  | { type: 'start'; utteranceId: number; source: SpeechSource; chunkCount: number }
  | { type: 'chunk_ready'; utteranceId: number; chunkIndex: number; chunkText: string }
  | { type: 'fact'; fact: SpeechPlaybackFact }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'dismiss' };

export const SPEECH_INITIAL: SpeechSnapshot = {
  state: 'idle',
  source: null,
  utteranceId: 0,
  chunkIndex: 0,
  chunkCount: 0,
  chunkText: '',
  resumeTo: null,
  dismissed: false,
  lastError: null,
};

export function isSpeechActive(state: SpeechState): boolean {
  return state !== 'idle';
}

/**
 * Source-weighted preemption (plan 58 D6): an explicit gesture (`selection`,
 * `clipboard`, `preview`) preempts an automatic utterance (`reply`,
 * `replay`); the reverse never happens, and neither does same-source
 * preemption — that is the depth-1 queue's call.
 */
export function speechPreempts(current: SpeechSource | null, next: SpeechSource): boolean {
  if (current === null) {
    return true;
  }
  if (current === next) {
    return false;
  }
  return isExplicitSpeechSource(next) && !isExplicitSpeechSource(current);
}

export function isExplicitSpeechSource(source: SpeechSource): boolean {
  return source === 'selection' || source === 'clipboard' || source === 'preview';
}

/** Neither source preempts the other — the depth-1 queue + inaudible-replace rules apply. */
export function speechSameTier(left: SpeechSource | null, right: SpeechSource): boolean {
  if (left === null) {
    return false;
  }
  return isExplicitSpeechSource(left) === isExplicitSpeechSource(right);
}

function idleSnapshot(snapshot: SpeechSnapshot, patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return {
    ...snapshot,
    state: 'idle',
    source: null,
    chunkIndex: 0,
    chunkCount: 0,
    chunkText: '',
    resumeTo: null,
    lastError: null,
    ...patch,
  };
}

export function reduceSpeech(snapshot: SpeechSnapshot, action: SpeechAction): SpeechSnapshot {
  switch (action.type) {
    case 'start': {
      if (action.utteranceId <= snapshot.utteranceId) {
        return snapshot;
      }
      if (isSpeechActive(snapshot.state) && !speechPreempts(snapshot.source, action.source)) {
        return snapshot;
      }
      return {
        state: 'synthesizing',
        source: action.source,
        utteranceId: action.utteranceId,
        chunkIndex: 0,
        chunkCount: Math.max(1, action.chunkCount),
        chunkText: '',
        resumeTo: null,
        dismissed: false,
        lastError: null,
      };
    }

    case 'chunk_ready': {
      if (action.utteranceId !== snapshot.utteranceId || snapshot.state === 'idle') {
        return snapshot;
      }
      return {
        ...snapshot,
        chunkIndex: action.chunkIndex,
        chunkCount: Math.max(snapshot.chunkCount, action.chunkIndex + 1),
        chunkText: action.chunkText,
      };
    }

    case 'fact': {
      const fact = action.fact;
      if (fact.utteranceId !== snapshot.utteranceId || snapshot.state === 'idle') {
        return snapshot;
      }
      if (fact.chunkIndex < snapshot.chunkIndex) {
        return snapshot;
      }
      if (fact.fact === 'chunk_started') {
        if (snapshot.state !== 'synthesizing' && snapshot.state !== 'speaking') {
          return snapshot;
        }
        return { ...snapshot, state: 'speaking', chunkIndex: fact.chunkIndex };
      }
      if (fact.fact === 'ended') {
        if (snapshot.state !== 'speaking') {
          return snapshot;
        }
        if (fact.chunkIndex + 1 < snapshot.chunkCount) {
          return { ...snapshot, chunkIndex: fact.chunkIndex + 1 };
        }
        return idleSnapshot(snapshot);
      }
      return idleSnapshot(snapshot, { lastError: fact.detail ?? '' });
    }

    case 'pause': {
      if (snapshot.state !== 'synthesizing' && snapshot.state !== 'speaking') {
        return snapshot;
      }
      return { ...snapshot, state: 'paused', resumeTo: snapshot.state };
    }

    case 'resume': {
      if (snapshot.state !== 'paused') {
        return snapshot;
      }
      return { ...snapshot, state: snapshot.resumeTo ?? 'speaking', resumeTo: null };
    }

    case 'stop':
      return snapshot.state === 'idle' ? snapshot : idleSnapshot(snapshot);

    case 'dismiss':
      return snapshot.dismissed ? snapshot : { ...snapshot, dismissed: true };
  }
}
