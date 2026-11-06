// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { SPEECH_INITIAL, type SpeechPlayInstruction, type SpeechSnapshot } from '@shared/speech';
import { SpeechOverlayApp, useSpeechSnapshot } from '@renderer/speech-overlay-react/SpeechOverlayApp';

afterEach(cleanup);

const CHUNK: SpeechPlayInstruction = { utteranceId: 9, chunkIndex: 3, url: 'speech-cache://chunk/abc.wav' };

function snapshot(patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return {
    ...SPEECH_INITIAL,
    state: 'speaking',
    source: 'selection',
    utteranceId: 9,
    chunkIndex: 3,
    chunkCount: 8,
    chunkText: 'resume here',
    ...patch,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function installApi(options: {
  snapshot: SpeechSnapshot | Promise<SpeechSnapshot>;
  chunk?: SpeechPlayInstruction | null | Promise<SpeechPlayInstruction | null>;
}) {
  const stateHandler = { current: null as ((next: SpeechSnapshot) => void) | null };
  const playHandler = { current: null as ((instruction: SpeechPlayInstruction) => void) | null };
  const api = {
    onSpeechState: (callback: (next: SpeechSnapshot) => void) => {
      stateHandler.current = callback;
      return () => {
        stateHandler.current = null;
      };
    },
    onSpeechPlay: (callback: (instruction: SpeechPlayInstruction) => void) => {
      playHandler.current = callback;
      return () => {
        playHandler.current = null;
      };
    },
    onSpeechStop: () => () => undefined,
    getSpeechSnapshot: vi.fn(async () => options.snapshot),
    getSpeechChunk: vi.fn(async () =>
      options.chunk === undefined ? CHUNK : options.chunk
    ),
    controlSpeech: vi.fn(),
    reportSpeechFact: vi.fn(),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return { api, stateHandler, playHandler };
}

function controller() {
  return { play: vi.fn(), stop: vi.fn(), setState: vi.fn() };
}

describe('speech overlay resync (plan 58 §4.2 crash recovery)', () => {
  it('resumes the current chunk after a recreate', async () => {
    installApi({ snapshot: snapshot() });
    const playback = controller();
    render(<SpeechOverlayApp controller={playback} />);
    await waitFor(() => expect(playback.play).toHaveBeenCalledWith(CHUNK));
    await waitFor(() => expect(playback.setState).toHaveBeenCalledWith('speaking'));
  });

  it('does not double-play when a live play instruction wins the race', async () => {
    const snap = deferred<SpeechSnapshot>();
    const chunkPull = deferred<SpeechPlayInstruction | null>();
    const { api, playHandler } = installApi({ snapshot: snap.promise, chunk: chunkPull.promise });
    const playback = controller();
    render(<SpeechOverlayApp controller={playback} />);
    await waitFor(() => expect(api.getSpeechSnapshot).toHaveBeenCalled());

    const live: SpeechPlayInstruction = { utteranceId: 9, chunkIndex: 4, url: 'data:audio/wav;base64,AAAA' };
    playHandler.current?.(live);
    snap.resolve(snapshot({ chunkIndex: 4 }));
    chunkPull.resolve(CHUNK);
    await waitFor(() => expect(playback.play).toHaveBeenCalledTimes(1));
    expect(playback.play).toHaveBeenCalledWith(live);
  });

  it('stays silent when the bus is idle', async () => {
    installApi({ snapshot: { ...SPEECH_INITIAL } });
    const playback = controller();
    render(<SpeechOverlayApp controller={playback} />);
    await waitFor(() => expect(playback.setState).toHaveBeenCalledWith('idle'));
    expect(playback.play).not.toHaveBeenCalled();
  });
});

describe('useSpeechSnapshot (latest event wins)', () => {
  function Probe(): React.ReactElement {
    const snap = useSpeechSnapshot();
    return <span data-testid="state">{snap.state}</span>;
  }

  it('keeps an event that arrives while the pull is in flight', async () => {
    const pending = deferred<SpeechSnapshot>();
    const { stateHandler } = installApi({ snapshot: pending.promise });
    const { getByTestId } = render(<Probe />);
    stateHandler.current?.(snapshot({ state: 'paused' }));
    pending.resolve(snapshot({ state: 'speaking' }));
    await waitFor(() => expect(getByTestId('state').textContent).toBe('paused'));
  });
});
