// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TEXT } from '@shared/constants/text';
import type { TurnEvent } from '@shared/turns';
import { useHudDictation } from '@renderer/speech-overlay-react/useHudDictation';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const recorder = {
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);
    },
    off: (event: string, callback: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(callback);
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((callback) => callback(...args));
    },
    setLiveProfile: () => undefined,
    setCaptureEnabled: () => undefined,
    startRecording: async () => undefined,
    stopRecording: async () => 'hello from the hud',
    cancelRecording: () => undefined,
  };
  return { recorder, listeners };
});

vi.mock('@renderer/managers/RecordingManager', () => ({
  RecordingManager: { getInstance: () => fake.recorder },
}));

function Probe(): React.ReactElement {
  const dictation = useHudDictation({ enabled: true, resultAutoHideMs: 0 });
  return (
    <div>
      <span data-testid="state">{dictation.state}</span>
      <span data-testid="active">{dictation.active ? 'yes' : 'no'}</span>
      <span data-testid="text">{dictation.text}</span>
      <span data-testid="transcript">{dictation.transcript}</span>
      <span data-testid="handOff">{dictation.handOffText}</span>
      <button type="button" onClick={() => void dictation.start()}>
        start
      </button>
      <button type="button" onClick={() => void dictation.send()}>
        send
      </button>
      <button type="button" onClick={() => void dictation.resume()}>
        resume
      </button>
      <button type="button" onClick={dictation.cancel}>
        cancel
      </button>
    </div>
  );
}

function installApi(): {
  startTurn: ReturnType<typeof vi.fn>;
  speakText: ReturnType<typeof vi.fn>;
  emitTurn: (event: TurnEvent) => void;
  stopRecording: ReturnType<typeof vi.fn>;
  reportDictation: ReturnType<typeof vi.fn>;
  requestStop: () => void;
} {
  let onTurn: ((event: TurnEvent) => void) | null = null;
  let onStopRequest: (() => void) | null = null;
  const reportDictation = vi.fn(async () => ({
    phase: 'idle',
    origin: 'hud',
    interim: '',
    transcript: '',
    level: 0,
    error: null,
  }));
  const startTurn = vi.fn(async () => ({ tempMessageId: 'turn-1', queued: false }));
  const speakText = vi.fn(async () => ({ outcome: 'started' }));
  const stopRecording = vi.spyOn(fake.recorder, 'stopRecording');
  window.electronAPI = {
    loadConfig: async () => ({
      voice: { enabled: true },
      taskAssignments: { stt: 'demo-stt' },
    }),
    getAllConversations: async () => [{ id: 'voice-conv', title: TEXT.HUB_VOICE_CONVERSATION_TITLE }],
    createConversation: vi.fn(),
    startTurn,
    speakText,
    beginDictation: async () => ({
      ok: true,
      snapshot: { phase: 'recording', origin: 'hud', interim: '', transcript: '', level: 0, error: null },
    }),
    reportDictation,
    endDictation: async () => ({
      phase: 'idle',
      origin: null,
      interim: '',
      transcript: '',
      level: 0,
      error: null,
    }),
    onDictationStopRequest: (callback: () => void) => {
      onStopRequest = callback;
      return () => {
        onStopRequest = null;
      };
    },
    onTurnEvent: (callback: (event: TurnEvent) => void) => {
      onTurn = callback;
      return () => {
        onTurn = null;
      };
    },
  } as unknown as typeof window.electronAPI;
  return {
    startTurn,
    speakText,
    stopRecording,
    reportDictation,
    requestStop: () => onStopRequest?.(),
    emitTurn: (event) => onTurn?.(event),
  };
}

function turn(phase: TurnEvent['phase'], patch: Partial<TurnEvent> = {}): TurnEvent {
  return {
    tempMessageId: 'turn-1',
    conversationId: 'voice-conv',
    seq: 1,
    phase,
    ...patch,
  };
}

beforeEach(() => {
  fake.recorder.stopRecording = async () => 'hello from the hud';
  fake.recorder.startRecording = async () => undefined;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HUD dictation (autonomous from the launcher)', () => {
  it('records in the HUD, stops on send and streams the reply without auto-speaking it', async () => {
    const api = installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    expect(screen.getByTestId('text').textContent).toBe(TEXT.HUB_DICTATION_LISTENING);

    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('thinking'));
    expect(api.stopRecording).toHaveBeenCalledTimes(1);
    expect(api.startTurn).toHaveBeenCalledWith({
      conversationId: 'voice-conv',
      content: 'hello from the hud',
    });

    act(() => api.emitTurn(turn('streaming', { delta: 'The answer.' })));
    expect(screen.getByTestId('state').textContent).toBe('streaming');
    expect(screen.getByTestId('text').textContent).toBe('The answer.');

    act(() => api.emitTurn(turn('finished')));
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(screen.getByTestId('text').textContent).toBe('The answer.');
    // The user's words stay available for the hand-off; the reply does not.
    expect(screen.getByTestId('transcript').textContent).toBe('hello from the hud');
    // …but the sent question is already in the conversation: home must not
    // paste it into the composer a second time.
    expect(screen.getByTestId('handOff').textContent).toBe('');
    // The HUD never auto-plays a reply; the face offers a Speak button instead.
    expect(api.speakText).not.toHaveBeenCalled();
  });

  it('hands an unsent transcript to home and drops it after the turn', async () => {
    const api = installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    act(() => fake.recorder.emit('transcript:received', 'unsent words'));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready'));
    expect(screen.getByTestId('handOff').textContent).toBe('unsent words');

    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(api.startTurn).toHaveBeenCalled());
    expect(screen.getByTestId('handOff').textContent).toBe('');
  });

  it('sends a transcript that endpointing already completed', async () => {
    const api = installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    act(() => fake.recorder.emit('transcript:received', 'already transcribed'));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready'));
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(api.startTurn).toHaveBeenCalledWith({
        conversationId: 'voice-conv',
        content: 'already transcribed',
      })
    );
    expect(api.stopRecording).not.toHaveBeenCalled();
  });

  it('refuses the mic when voice is off and never opens a turn', async () => {
    const api = installApi();
    const start = vi.spyOn(fake.recorder, 'startRecording');
    (window.electronAPI as unknown as { loadConfig: () => Promise<unknown> }).loadConfig = async () => ({
      voice: { enabled: false },
      taskAssignments: { stt: null },
    });
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('error'));
    expect(screen.getByTestId('text').textContent).toBe(TEXT.HUB_DICTATION_UNAVAILABLE);
    expect(start).not.toHaveBeenCalled();
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('lands on the transcript when the recorder stops itself (dictation endpoint)', async () => {
    const api = installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));

    act(() => fake.recorder.emit('transcript:received', 'hello there'));
    expect(screen.getByTestId('state').textContent).toBe('ready');
    act(() => fake.recorder.emit('state:change', 'idle'));

    // The dock must show the words, not fall back to "Listening…" or an error.
    expect(screen.getByTestId('state').textContent).toBe('ready');
    expect(screen.getByTestId('text').textContent).toBe('hello there');
    expect(api.startTurn).not.toHaveBeenCalled();
  });

  it('commits the transcript when another window asks the HUD to stop', async () => {
    const api = installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));

    act(() => api.requestStop());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('ready'));
    expect(screen.getByTestId('text').textContent).toBe('hello from the hud');
    expect(api.stopRecording).toHaveBeenCalledTimes(1);
    expect(api.startTurn).not.toHaveBeenCalled();
    expect(api.reportDictation).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'ready', transcript: 'hello from the hud' })
    );
  });

  it('continues a stopped dictation without losing what was already said', async () => {
    installApi();
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    act(() => fake.recorder.emit('transcript:received', 'hello'));
    act(() => fake.recorder.emit('state:change', 'idle'));
    expect(screen.getByTestId('state').textContent).toBe('ready');

    fireEvent.click(screen.getByRole('button', { name: 'resume' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    // Listening again, not the old text.
    expect(screen.getByTestId('text').textContent).toBe(TEXT.HUB_DICTATION_LISTENING);

    act(() => fake.recorder.emit('transcript:received', 'world'));
    expect(screen.getByTestId('state').textContent).toBe('ready');
    expect(screen.getByTestId('text').textContent).toBe('hello world');
    expect(screen.getByTestId('transcript').textContent).toBe('hello world');
  });

  it('cancels without starting a turn', async () => {
    const api = installApi();
    const cancel = vi.spyOn(fake.recorder, 'cancelRecording');
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('recording'));
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('state').textContent).toBe('idle');
    expect(api.startTurn).not.toHaveBeenCalled();
  });
});

describe('HUD dictation reflects the recorder (plan 82 fix)', () => {
  it('shows as active and adopts the phase when the recorder is already recording', async () => {
    installApi();
    render(<Probe />);
    expect(screen.getByTestId('active').textContent).toBe('no');

    act(() => {
      fake.recorder.emit('state:change', 'recording');
    });

    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('yes'));
    expect(screen.getByTestId('state').textContent).toBe('recording');
  });

  it('drops back to inactive when the recorder stops', async () => {
    installApi();
    render(<Probe />);
    act(() => {
      fake.recorder.emit('state:change', 'recording');
    });
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('yes'));

    act(() => {
      fake.recorder.emit('state:change', 'idle');
    });
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('no'));
  });
});
