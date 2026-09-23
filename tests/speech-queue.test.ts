import { describe, it, expect, vi } from 'vitest';
import { createSpeechQueue } from '@renderer/chat-react/speechQueue';

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  volume = 1;
  src = '';
  play(): Promise<void> {
    this.onplaying?.();
    return Promise.resolve();
  }
  pause(): void {}
  finish(): void {
    this.onended?.();
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(): { audios: FakeAudio[]; queue: ReturnType<typeof createSpeechQueue> } {
  const audios: FakeAudio[] = [];
  const queue = createSpeechQueue(() => {
    const audio = new FakeAudio();
    audios.push(audio);
    return audio as unknown as HTMLAudioElement;
  });
  return { audios, queue };
}

describe('createSpeechQueue (plan 25 D8)', () => {
  it('plays every chunk in order, prefetching the next', async () => {
    const { audios, queue } = harness();
    const synth = vi.fn(async (text: string) => `data:${text}`);
    const done = queue.play(['one', 'two'], synth);
    await tick();
    expect(audios).toHaveLength(1);
    audios[0].finish();
    await tick();
    expect(audios).toHaveLength(2);
    audios[1].finish();
    await done;
    expect(synth).toHaveBeenCalledTimes(2);
  });

  it('stops early without playing the remaining chunks', async () => {
    const { audios, queue } = harness();
    const synth = vi.fn(async (text: string) => `data:${text}`);
    const done = queue.play(['one', 'two', 'three'], synth);
    await tick();
    queue.stop();
    await done;
    expect(audios).toHaveLength(1);
  });

  it('reports each chunk as it starts', async () => {
    const { audios, queue } = harness();
    const chunks: string[] = [];
    const done = queue.play(['one', 'two'], async (text) => `data:${text}`, (text) => chunks.push(text));
    await tick();
    audios[0].finish();
    await tick();
    audios[1].finish();
    await done;
    expect(chunks).toEqual(['one', 'two']);
  });
});
