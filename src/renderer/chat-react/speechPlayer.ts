export interface SpeechPlayer {
  /** Starts playback; resolves when done, or early on stop(). */
  play(dataUrl: string): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
}

/**
 * HTMLAudio-backed playback with a stop latch. The audio factory is
 * injectable so tests can fake playback without a media stack.
 */
export function createSpeechPlayer(createAudio: (src: string) => HTMLAudioElement = (src) => new Audio(src)): SpeechPlayer {
  let current: HTMLAudioElement | null = null;
  let generation = 0;

  return {
    play(dataUrl: string): Promise<void> {
      generation += 1;
      const mine = generation;
      this.stop();
      return new Promise<void>((resolve) => {
        const audio = createAudio(dataUrl);
        current = audio;
        const settle = (): void => {
          if (mine === generation) {
            current = null;
            resolve();
          }
        };
        audio.onended = settle;
        audio.onerror = settle;
        audio.play().catch(() => settle());
      });
    },
    stop(): void {
      generation += 1;
      if (current) {
        current.pause();
        current.src = '';
        current = null;
      }
    },
    isPlaying(): boolean {
      return current !== null;
    },
  };
}
