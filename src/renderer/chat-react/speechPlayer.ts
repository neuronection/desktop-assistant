export interface SpeechPlayer {
  /** Starts playback; resolves when done, or early on stop(). */
  play(dataUrl: string): Promise<void>;
  stop(): void;
  /** Lowers the current element's volume while a barge-in candidate is classified. */
  duck(on: boolean): void;
  isPlaying(): boolean;
}

/** A blocked/broken media load can fire no events at all (e.g. CSP) — never wait past this. */
const START_TIMEOUT_MS = 10_000;
/** Playback volume while a barge-in candidate is being judged (plan 25 D16). */
const DUCK_VOLUME = 0.2;

/**
 * HTMLAudio-backed playback with a stop latch. The audio factory is
 * injectable so tests can fake playback without a media stack.
 */
export function createSpeechPlayer(createAudio: (src: string) => HTMLAudioElement = (src) => new Audio(src)): SpeechPlayer {
  let current: HTMLAudioElement | null = null;
  let generation = 0;
  let startTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStartTimer = (): void => {
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
  };

  return {
    play(dataUrl: string): Promise<void> {
      this.stop();
      const mine = ++generation;
      return new Promise<void>((resolve) => {
        const audio = createAudio(dataUrl);
        current = audio;
        const settle = (): void => {
          clearStartTimer();
          if (mine === generation) {
            current = null;
            resolve();
          }
        };
        startTimer = setTimeout(settle, START_TIMEOUT_MS);
        audio.onended = settle;
        audio.onerror = settle;
        audio.onplaying = clearStartTimer;
        audio.play().catch(() => settle());
      });
    },
    stop(): void {
      generation += 1;
      clearStartTimer();
      if (current) {
        current.pause();
        current.src = '';
        current = null;
      }
    },
    duck(on: boolean): void {
      if (current) {
        current.volume = on ? DUCK_VOLUME : 1;
      }
    },
    isPlaying(): boolean {
      return current !== null;
    },
  };
}
