export interface SpeechQueue {
  /**
   * Plays chunks in order, synthesizing the next while the current plays.
   * Resolves on drain or stop. `synthesize` returns a data URL or null.
   */
  play(
    chunks: string[],
    synthesize: (text: string) => Promise<string | null>,
    onChunk?: (text: string) => void
  ): Promise<void>;
  stop(): void;
  duck(on: boolean): void;
  isPlaying(): boolean;
}

/** A blocked/broken media load can fire no events at all (e.g. CSP) — never wait past this. */
const START_TIMEOUT_MS = 10_000;
const DUCK_VOLUME = 0.2;

/**
 * Chunked TTS playback (plan 25 D8): one audio element per chunk, the next
 * synthesized while the current plays, so an interrupt stops paying for the
 * rest of a long reply. Injectable audio factory for tests.
 */
export function createSpeechQueue(
  createAudio: (src: string) => HTMLAudioElement = (src) => new Audio(src)
): SpeechQueue {
  let generation = 0;
  let current: HTMLAudioElement | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let settleCurrent: (() => void) | null = null;

  const clearStartTimer = (): void => {
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
  };

  const playUrl = (dataUrl: string, mine: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      const audio = createAudio(dataUrl);
      current = audio;
      const settle = (): void => {
        clearStartTimer();
        if (mine === generation) {
          current = null;
        }
        if (settleCurrent === settle) {
          settleCurrent = null;
        }
        resolve();
      };
      settleCurrent = settle;
      startTimer = setTimeout(settle, START_TIMEOUT_MS);
      audio.onended = settle;
      audio.onerror = settle;
      audio.onplaying = clearStartTimer;
      audio.play().catch(() => settle());
    });
  };

  return {
    async play(chunks, synthesize, onChunk) {
      this.stop();
      const mine = ++generation;
      const pending = new Map<number, Promise<string | null>>();
      const synthAt = (index: number): Promise<string | null> => {
        if (index >= chunks.length) {
          return Promise.resolve(null);
        }
        let promise = pending.get(index);
        if (!promise) {
          promise = synthesize(chunks[index]).catch(() => null);
          pending.set(index, promise);
        }
        return promise;
      };
      for (let index = 0; index < chunks.length; index += 1) {
        if (mine !== generation) {
          return;
        }
        const dataUrl = await synthAt(index);
        if (mine !== generation) {
          return;
        }
        if (!dataUrl) {
          continue;
        }
        onChunk?.(chunks[index]);
        void synthAt(index + 1);
        await playUrl(dataUrl, mine);
      }
    },
    stop() {
      generation += 1;
      clearStartTimer();
      if (current) {
        current.pause();
        current.src = '';
        current = null;
      }
      settleCurrent?.();
      settleCurrent = null;
    },
    duck(on: boolean) {
      if (current) {
        current.volume = on ? DUCK_VOLUME : 1;
      }
    },
    isPlaying() {
      return current !== null;
    },
  };
}
