import type { SpeechPlaybackFact, SpeechPlayInstruction, SpeechState } from '@shared/speech';

export interface OverlayAudio {
  src: string;
  currentTime: number;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'playing' | 'ended' | 'error', listener: () => void): void;
}

export interface SpeechPlaybackDeps {
  createAudio: (src: string) => OverlayAudio;
  report: (fact: SpeechPlaybackFact) => void;
  setTimeout?: (fn: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
  setInterval?: (fn: () => void, ms: number) => number;
  clearInterval?: (handle: number) => void;
  startGuardMs?: number;
  watchdogMs?: number;
  watchdogTickMs?: number;
}

export interface SpeechPlaybackController {
  play(instruction: SpeechPlayInstruction): void;
  stop(): void;
  setState(state: SpeechState): void;
}

export const PLAYBACK_START_GUARD_MS = 10_000;
export const PLAYBACK_WATCHDOG_MS = 5_000;
export const PLAYBACK_WATCHDOG_TICK_MS = 1_000;

/**
 * Overlay playback (plan 58 §4.2 / race 5/11): one audio element per chunk,
 * facts reported back to main. A pause that lands before `play()` resolves
 * rejects with AbortError — that is PAUSED, never a chunk end, and the
 * start guard does not settle while paused. A frozen `currentTime` (BT
 * disconnect) trips a progress watchdog because the browser fires nothing.
 */
export function createSpeechPlaybackController(deps: SpeechPlaybackDeps): SpeechPlaybackController {
  const startGuardMs = deps.startGuardMs ?? PLAYBACK_START_GUARD_MS;
  const watchdogMs = deps.watchdogMs ?? PLAYBACK_WATCHDOG_MS;
  const watchdogTickMs = deps.watchdogTickMs ?? PLAYBACK_WATCHDOG_TICK_MS;
  const setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle));
  const setTick = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms) as unknown as number);
  const clearTick = deps.clearInterval ?? ((handle) => clearInterval(handle));

  let generation = 0;
  let current: { audio: OverlayAudio; instruction: SpeechPlayInstruction } | null = null;
  let state: SpeechState = 'idle';
  let started = false;
  let startedReported = false;
  let guard: number | null = null;
  let watchdog: number | null = null;
  let lastTime = 0;
  let stalledFor = 0;
  let deviceLost = false;

  const clearGuard = (): void => {
    if (guard !== null) {
      clearTimer(guard);
      guard = null;
    }
  };

  const clearWatchdog = (): void => {
    if (watchdog !== null) {
      clearTick(watchdog);
      watchdog = null;
    }
  };

  const clearAll = (): void => {
    clearGuard();
    clearWatchdog();
  };

  const fact = (instruction: SpeechPlayInstruction, kind: SpeechPlaybackFact['fact'], detail?: string): void => {
    deps.report({
      utteranceId: instruction.utteranceId,
      chunkIndex: instruction.chunkIndex,
      fact: kind,
      ...(detail ? { detail } : {}),
    });
  };

  const armGuard = (mine: number): void => {
    clearGuard();
    guard = setTimer(() => {
      guard = null;
      if (mine !== generation || started || state === 'paused') {
        return;
      }
      if (current) {
        fact(current.instruction, 'error', 'start_timeout');
      }
    }, startGuardMs);
  };

  const startWatchdog = (mine: number): void => {
    clearWatchdog();
    lastTime = current?.audio.currentTime ?? 0;
    stalledFor = 0;
    watchdog = setTick(() => {
      if (mine !== generation || !current || state === 'paused') {
        return;
      }
      const position = current.audio.currentTime;
      if (position !== lastTime) {
        lastTime = position;
        stalledFor = 0;
        return;
      }
      stalledFor += watchdogTickMs;
      if (stalledFor < watchdogMs) {
        return;
      }
      stalledFor = 0;
      if (!deviceLost) {
        deviceLost = true;
        clearAll();
        fact(current.instruction, 'error', 'playback_device_lost');
        return;
      }
      clearAll();
      fact(current.instruction, 'ended');
    }, watchdogTickMs);
  };

  const release = (): void => {
    clearAll();
    const audio = current?.audio;
    current = null;
    started = false;
    startedReported = false;
    stalledFor = 0;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // element already torn down
      }
    }
  };

  const play = (instruction: SpeechPlayInstruction): void => {
    generation += 1;
    const mine = generation;
    release();
    const audio = deps.createAudio(instruction.url);
    current = { audio, instruction };
    audio.addEventListener('playing', () => {
      if (mine !== generation) {
        return;
      }
      started = true;
      clearGuard();
      if (!startedReported) {
        startedReported = true;
        fact(instruction, 'chunk_started');
      }
      if (state !== 'paused') {
        startWatchdog(mine);
      }
    });
    audio.addEventListener('ended', () => {
      if (mine !== generation) {
        return;
      }
      clearAll();
      fact(instruction, 'ended');
    });
    audio.addEventListener('error', () => {
      if (mine !== generation) {
        return;
      }
      clearAll();
      fact(instruction, 'error', 'media_error');
    });
    armGuard(mine);
    void audio.play().catch((error: Error) => {
      if (mine !== generation || error?.name === 'AbortError') {
        return;
      }
      clearAll();
      fact(instruction, 'error', error?.name ?? 'play_failed');
    });
  };

  const stop = (): void => {
    generation += 1;
    release();
  };

  const setState = (next: SpeechState): void => {
    const previous = state;
    state = next;
    if (next === 'idle') {
      stop();
      return;
    }
    if (next === 'paused') {
      if (previous !== 'paused') {
        clearAll();
        current?.audio.pause();
      }
      return;
    }
    if (next === 'speaking' && previous === 'paused' && current) {
      const mine = generation;
      const audio = current.audio;
      const instruction = current.instruction;
      if (!started) {
        armGuard(mine);
      } else {
        startWatchdog(mine);
      }
      void audio.play().catch((error: Error) => {
        if (mine !== generation || error?.name === 'AbortError') {
          return;
        }
        clearAll();
        fact(instruction, 'error', error?.name ?? 'resume_failed');
      });
    }
  };

  return { play, stop, setState };
}
