/**
 * One dictation session, shared by every surface (plan 83 S1).
 *
 * The recorder lives in one renderer, but the session belongs to main: the
 * HUD, the launcher and the desktop window all render this snapshot, so a
 * dictation started in one of them is visible (and stoppable) in the others.
 */
export const DICTATION_PHASES = [
  'idle',
  'recording',
  'transcribing',
  'ready',
  'sending',
  'error',
] as const;

export type DictationPhase = (typeof DICTATION_PHASES)[number];

/** Where the session was started; the origin owns the recorder and the landing spot. */
export const DICTATION_ORIGINS = ['hud', 'launcher', 'desktop', 'hotkey'] as const;

export type DictationOrigin = (typeof DICTATION_ORIGINS)[number];

export interface DictationSnapshot {
  phase: DictationPhase;
  origin: DictationOrigin | null;
  /** Volatile partial text; never sent as a message. */
  interim: string;
  /** Everything committed in this session (phrase rotation included). */
  transcript: string;
  /** Smoothed mic level, 0..1. */
  level: number;
  error: string | null;
}

export const DICTATION_IDLE: DictationSnapshot = {
  phase: 'idle',
  origin: null,
  interim: '',
  transcript: '',
  level: 0,
  error: null,
};

export const DICTATION_MAX_TEXT = 20_000;

export function dictationActive(snapshot: DictationSnapshot | null | undefined): boolean {
  return !!snapshot && snapshot.phase !== 'idle';
}

export function dictationBusy(snapshot: DictationSnapshot): boolean {
  return snapshot.phase === 'recording' || snapshot.phase === 'transcribing';
}

/** A patch from the owner, clamped to what the snapshot can carry. */
export function normalizeDictationPatch(patch: Partial<DictationSnapshot>): Partial<DictationSnapshot> {
  const next: Partial<DictationSnapshot> = {};
  if (patch.phase !== undefined && (DICTATION_PHASES as readonly string[]).includes(patch.phase)) {
    next.phase = patch.phase;
  }
  if (patch.origin !== undefined) {
    next.origin =
      patch.origin !== null && (DICTATION_ORIGINS as readonly string[]).includes(patch.origin)
        ? patch.origin
        : null;
  }
  if (patch.interim !== undefined) {
    next.interim = String(patch.interim).slice(0, DICTATION_MAX_TEXT);
  }
  if (patch.transcript !== undefined) {
    next.transcript = String(patch.transcript).slice(0, DICTATION_MAX_TEXT);
  }
  if (patch.level !== undefined) {
    const level = Number(patch.level);
    next.level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  }
  if (patch.error !== undefined) {
    next.error = patch.error === null ? null : String(patch.error).slice(0, 500);
  }
  return next;
}
