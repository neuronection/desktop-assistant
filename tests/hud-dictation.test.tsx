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
      <span data-testid="text">{dictation.text}</span>
      <button type="button" onClick={() => void dictation.start()}>
        start
      </button>
      <button type="button" onClick={() => void dictation.send()}>
        send
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
} {
  let onTurn: ((event: TurnEvent) => void) | null = null;
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
  it('records in the HUD, stops on send and streams/speaks the reply', async () => {
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
    expect(api.speakText).toHaveBeenCalledWith({
      text: 'The answer.',
      source: 'reply',
      dedupeKey: 'turn-1',
    });
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
