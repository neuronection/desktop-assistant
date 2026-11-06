import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SpeechPlaybackFact, SpeechPlayInstruction } from '@shared/speech';
import {
  createSpeechPlaybackController,
  type OverlayAudio,
} from '@renderer/speech-overlay-react/playback';

class FakeAudio implements OverlayAudio {
  src: string;
  currentTime = 0;
  paused = true;
  readonly listeners = new Map<string, (() => void)[]>();
  playResult: Promise<void> = Promise.resolve();
  readonly play = vi.fn(() => {
    this.paused = false;
    return this.playResult;
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(src: string) {
    this.src = src;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function setup() {
  const audios: FakeAudio[] = [];
  const facts: SpeechPlaybackFact[] = [];
  let nextPlayResult: Promise<void> | null = null;
  const controller = createSpeechPlaybackController({
    createAudio: (src) => {
      const audio = new FakeAudio(src);
      if (nextPlayResult) {
        audio.playResult = nextPlayResult;
        nextPlayResult = null;
      }
      audios.push(audio);
      return audio;
    },
    report: (fact) => facts.push(fact),
  });
  return {
    audios,
    facts,
    controller,
    queuePlayResult: (result: Promise<void>) => {
      nextPlayResult = result;
    },
  };
}

const chunk = (utteranceId = 1, chunkIndex = 0): SpeechPlayInstruction => ({
  utteranceId,
  chunkIndex,
  url: `data:audio/wav;base64,AAAA${chunkIndex}`,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('speech playback controller (plan 58 §4.2)', () => {
  it('reports chunk_started and ended from the real media events', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk());
    expect(audios[0].src).toBe('data:audio/wav;base64,AAAA0');
    audios[0].emit('playing');
    expect(facts).toEqual([{ utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' }]);
    audios[0].emit('ended');
    expect(facts.at(-1)).toMatchObject({ fact: 'ended' });
  });

  it('ignores every late event from a previous generation', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk(1, 0));
    audios[0].emit('playing');
    controller.play(chunk(1, 1));
    audios[0].emit('ended');
    audios[0].emit('error');
    expect(facts).toEqual([{ utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' }]);
    expect(audios[0].pause).toHaveBeenCalled();
  });

  it('treats a pause-before-resolve AbortError as paused, never a chunk end', async () => {
    const { audios, facts, controller } = setup();
    controller.setState('paused');
    controller.play(chunk());
    audios[0].playResult = Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    audios[0].play();
    await vi.advanceTimersByTimeAsync(1);
    expect(facts).toEqual([]);
  });

  it('reports a rejected resume instead of leaving the bus speaking in silence', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk());
    audios[0].emit('playing');
    controller.setState('paused');
    audios[0].playResult = Promise.reject(Object.assign(new Error('device gone'), { name: 'NotSupportedError' }));
    controller.setState('speaking');
    await vi.advanceTimersByTimeAsync(1);
    expect(facts.at(-1)).toMatchObject({ fact: 'error', detail: 'NotSupportedError' });
  });

  it('fires the start guard after 10 s and reports it as an error', async () => {
    setup();
    const harness = setup();
    harness.controller.play(chunk());
    await vi.advanceTimersByTimeAsync(9_999);
    expect(harness.facts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.facts).toEqual([
      { utteranceId: 1, chunkIndex: 0, fact: 'error', detail: 'start_timeout' },
    ]);
  });

  it('does not settle the start guard across a pause', async () => {
    const { facts, controller } = setup();
    controller.play(chunk());
    controller.setState('paused');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(facts).toEqual([]);
    controller.setState('speaking');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(facts).toEqual([{ utteranceId: 1, chunkIndex: 0, fact: 'error', detail: 'start_timeout' }]);
  });

  it('resumes a paused element through play()', async () => {
    const { audios, controller } = setup();
    controller.play(chunk());
    audios[0].emit('playing');
    controller.setState('paused');
    expect(audios[0].pause).toHaveBeenCalled();
    controller.setState('speaking');
    expect(audios[0].play).toHaveBeenCalledTimes(2);
  });

  it('trips the 5 s progress watchdog once per session (device lost), then advances', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk(1, 0));
    audios[0].emit('playing');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(facts.at(-1)).toEqual({ utteranceId: 1, chunkIndex: 0, fact: 'error', detail: 'playback_device_lost' });

    controller.play(chunk(1, 1));
    audios[1].emit('playing');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(facts.at(-1)).toEqual({ utteranceId: 1, chunkIndex: 1, fact: 'ended' });
  });

  it('does not trip the watchdog while the device keeps progressing', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk());
    audios[0].emit('playing');
    for (let tick = 1; tick <= 6; tick += 1) {
      audios[0].currentTime = tick;
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(facts).toEqual([{ utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' }]);
  });

  it('drops everything after stop and pauses the element', async () => {
    const { audios, facts, controller } = setup();
    controller.play(chunk());
    controller.stop();
    audios[0].emit('playing');
    audios[0].emit('ended');
    expect(facts).toEqual([]);
    expect(audios[0].pause).toHaveBeenCalled();
  });

  it('reports a plain play() rejection as an error', async () => {
    const { facts, controller, queuePlayResult } = setup();
    queuePlayResult(Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' })));
    controller.play(chunk());
    await vi.advanceTimersByTimeAsync(1);
    expect(facts.at(-1)).toMatchObject({ fact: 'error', detail: 'NotAllowedError' });
  });
});
