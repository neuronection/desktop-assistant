import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSpeechPlayer } from '@renderer/chat-react/speechPlayer';

interface FakeAudio {
  src: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onplaying: (() => void) | null;
  play: () => Promise<void>;
  pause: () => void;
}

describe('createSpeechPlayer', () => {
  let audio: FakeAudio;

  beforeEach(() => {
    vi.useFakeTimers();
    audio = {
      src: '',
      onended: null,
      onerror: null,
      onplaying: null,
      play: () => Promise.resolve(),
      pause: () => undefined,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makePlayer = () => createSpeechPlayer(() => audio as unknown as HTMLAudioElement);

  it('resolves on ended', async () => {
    const player = makePlayer();
    const done = player.play('data:audio/wav;base64,xxx');
    audio.onplaying?.();
    audio.onended?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('resolves on error events and play rejections', async () => {
    const player = makePlayer();
    const first = player.play('data:audio/wav;base64,xxx');
    audio.onerror?.();
    await expect(first).resolves.toBeUndefined();

    audio.play = () => Promise.reject(new Error('blocked'));
    const second = player.play('data:audio/wav;base64,xxx');
    await expect(second).resolves.toBeUndefined();
  });

  it('resolves when playback never starts (CSP-blocked load fires no events)', async () => {
    const player = makePlayer();
    audio.play = () => new Promise<void>(() => undefined);
    const done = player.play('data:audio/wav;base64,xxx');
    const settled = vi.fn();
    done.then(settled);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledOnce();
    expect(player.isPlaying()).toBe(false);
  });

  it('does not let the watchdog cut off real playback', async () => {
    const player = makePlayer();
    audio.play = () => new Promise<void>(() => undefined);
    const done = player.play('data:audio/wav;base64,xxx');
    const settled = vi.fn();
    done.then(settled);
    await vi.advanceTimersByTimeAsync(5_000);
    audio.onplaying?.();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).not.toHaveBeenCalled();
    audio.onended?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('stop() cancels the pending watchdog', async () => {
    const player = makePlayer();
    audio.play = () => new Promise<void>(() => undefined);
    const first = player.play('data:audio/wav;base64,xxx');
    player.stop();
    const second = player.play('data:audio/wav;base64,yyy');
    const settled = vi.fn();
    first.then(settled);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(settled).not.toHaveBeenCalled();
    audio.onended?.();
    await expect(second).resolves.toBeUndefined();
  });
});
