// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import type { LiveSnapshot } from '@shared/live';
import type { TurnEvent } from '@shared/types';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

interface Harness {
  emit: (event: TurnEvent) => void;
  emitSpeech: (snapshot: SpeechSnapshot) => void;
  emitLive: (snapshot: LiveSnapshot) => void;
  api: Record<string, ReturnType<typeof vi.fn>>;
}

function speech(patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return { ...SPEECH_INITIAL, utteranceId: 3, source: 'reply', ...patch };
}

function mockApi(config: AppConfig = { ...DEFAULT_CONFIG }): Harness {
  const turnListeners: Array<(event: TurnEvent) => void> = [];
  const speechListeners: Array<(snapshot: SpeechSnapshot) => void> = [];
  const liveListeners: Array<(event: { type: string; snapshot?: LiveSnapshot }) => void> = [];
  const api = {
    loadConfig: vi.fn(async () => ({ ...config }) as AppConfig),
    onConfigUpdate: vi.fn(() => () => {}),
    getConversationById: vi.fn(async (id: string) => ({
      id,
      title: 'Test',
      messages: [{ id: 'a1', role: 'assistant', content: 'Hello there', createdAt: new Date() }],
    })),
    getAllConversations: vi.fn(async () => []),
    onTurnEvent: vi.fn((callback: (event: TurnEvent) => void) => {
      turnListeners.push(callback);
      return () => {};
    }),
    startTurn: vi.fn(async () => 'turn_1'),
    cancelTurn: vi.fn(async () => {}),
    resizeWindow: vi.fn(),
    hideWindow: vi.fn(),
    openDesktop: vi.fn(async () => {}),
    onSettingsOpen: vi.fn(async () => {}),
    onLauncherToggleExpand: vi.fn(() => () => {}),
    onStopSpeaking: vi.fn(() => () => {}),
    speakText: vi.fn(async () => 'started'),
    controlSpeech: vi.fn(async () => speech()),
    getSpeechSnapshot: vi.fn(async () => ({ ...SPEECH_INITIAL })),
    onSpeechState: vi.fn((callback: (snapshot: SpeechSnapshot) => void) => {
      speechListeners.push(callback);
      return () => {};
    }),
    getLiveState: vi.fn(async () => ({ ...LIVE_IDLE })),
    onLiveEvent: vi.fn((callback: (event: { type: string; snapshot?: LiveSnapshot }) => void) => {
      liveListeners.push(callback);
      return () => {};
    }),
    livePlaybackStarted: vi.fn(),
    livePlaybackEnded: vi.fn(),
    liveWarning: vi.fn(),
    synthesizeTts: vi.fn(async () => ({ audioBase64: 'AAAA', mime: 'audio/wav' })),
    cancelAudioOp: vi.fn(async () => true),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return {
    api,
    emit: (event) => turnListeners.forEach((listener) => listener(event)),
    emitSpeech: (snapshot) => speechListeners.forEach((listener) => listener(snapshot)),
    emitLive: (snapshot) => liveListeners.forEach((listener) => listener({ type: 'state', snapshot })),
  };
}

const LIVE_IDLE: LiveSnapshot = {
  state: 'idle',
  capture: 'closed',
  downgraded: false,
  turns: 0,
  candidate: false,
  session: 0,
};

const baseEvent = { tempMessageId: 'turn_1', conversationId: 'temp-1', model: 'm1' };

async function renderDoneReply(config?: AppConfig): Promise<Harness> {
  const harness = mockApi(config);
  render(<ChatApp onThemeChange={vi.fn()} />);
  const textarea = await screen.findByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'hello' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  await waitFor(() => expect(harness.api.startTurn).toHaveBeenCalled());
  harness.emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
  harness.emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hello' } as TurnEvent);
  harness.emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);
  await screen.findByText('Hello there');
  return harness;
}

describe('reply speech through the bus (plan 58 S6a)', () => {
  it('the explicit speak button hands the text to the bus instead of synthesizing locally', async () => {
    const harness = await renderDoneReply();
    fireEvent.click(screen.getByRole('button', { name: TEXT.SPEECH_SPEAK_REPLY }));

    await waitFor(() =>
      expect(harness.api.speakText).toHaveBeenCalledWith({ text: 'Hello there', source: 'reply' })
    );
    expect(harness.api.synthesizeTts).not.toHaveBeenCalled();
  });

  it('projects the bus snapshot into the SpeechBar (loading, progress, paused, idle)', async () => {
    const harness = await renderDoneReply();
    harness.emitSpeech(speech({ state: 'synthesizing', chunkCount: 5 }));
    expect(await screen.findByRole('status', { name: TEXT.SPEECH_PREPARING })).toBeTruthy();

    harness.emitSpeech(speech({ state: 'speaking', chunkIndex: 2, chunkCount: 5 }));
    expect(await screen.findByRole('status', { name: TEXT.SPEECH_SPEAKING })).toBeTruthy();
    expect(screen.getByText('3 of 5')).toBeTruthy();

    harness.emitSpeech(speech({ state: 'paused', chunkIndex: 2, chunkCount: 5 }));
    expect(await screen.findByRole('status', { name: TEXT.SPEECH_PAUSED })).toBeTruthy();

    harness.emitSpeech({ ...SPEECH_INITIAL });
    await waitFor(() => expect(screen.queryByRole('status', { name: TEXT.SPEECH_PAUSED })).toBeNull());
  });

  it('stop in the bar stops the bus when live is idle', async () => {
    const harness = await renderDoneReply();
    harness.emitSpeech(speech({ state: 'synthesizing', chunkCount: 2 }));
    const bar = await screen.findByRole('status', { name: TEXT.SPEECH_PREPARING });
    fireEvent.click(within(bar).getByRole('button', { name: TEXT.SPEECH_STOP }));
    expect(harness.api.controlSpeech).toHaveBeenCalledWith('stop');
  });

  it('pause in the bar toggles the bus', async () => {
    const harness = await renderDoneReply();
    harness.emitSpeech(speech({ state: 'speaking', chunkIndex: 0, chunkCount: 3 }));
    const bar = await screen.findByRole('status', { name: TEXT.SPEECH_SPEAKING });
    fireEvent.click(within(bar).getByRole('button', { name: TEXT.SPEECH_PAUSE }));
    expect(harness.api.controlSpeech).toHaveBeenCalledWith('pause');
  });

  it('auto-speaks a finished reply with the message id as the dedupe key', async () => {
    const harness = await renderDoneReply({
      ...DEFAULT_CONFIG,
      voice: { ...DEFAULT_CONFIG.voice, speakReplies: true },
    });
    await waitFor(() =>
      expect(harness.api.speakText).toHaveBeenCalledWith({
        text: 'Hello there',
        source: 'reply',
        dedupeKey: 'a1',
      })
    );
  });

  it('shows exactly one owner: live local state wins over the bus while live is active', async () => {
    const harness = mockApi();
    render(<ChatApp onThemeChange={vi.fn()} />);
    harness.emitLive({ ...LIVE_IDLE, state: 'speaking' });
    harness.emitSpeech(speech({ state: 'paused', chunkCount: 3 }));
    await waitFor(() => expect(screen.queryByRole('status', { name: TEXT.SPEECH_PAUSED })).toBeNull());
  });

  it('resyncs the bar from the bus snapshot after the launcher is recreated', async () => {
    const harness = mockApi();
    harness.api.getSpeechSnapshot.mockResolvedValueOnce(
      speech({ state: 'speaking', chunkIndex: 1, chunkCount: 4 }) as never
    );
    render(<ChatApp onThemeChange={vi.fn()} />);
    expect(await screen.findByRole('status', { name: TEXT.SPEECH_SPEAKING })).toBeTruthy();
    expect(screen.getByText('2 of 4')).toBeTruthy();
  });

  it('leaves live reply playback to the hidden host (no local queue or bus request)', async () => {
    const harness = mockApi({ ...DEFAULT_CONFIG, voice: { ...DEFAULT_CONFIG.voice, speakReplies: true } });
    render(<ChatApp onThemeChange={vi.fn()} />);
    const textarea = await screen.findByRole('textbox');
    harness.emitLive({ ...LIVE_IDLE, state: 'listening' });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(harness.api.startTurn).toHaveBeenCalled());
    harness.emit({ ...baseEvent, seq: 1, phase: 'queued' } as TurnEvent);
    harness.emit({ ...baseEvent, seq: 2, phase: 'streaming', delta: 'Hello' } as TurnEvent);
    harness.emit({ ...baseEvent, seq: 3, phase: 'finished' } as TurnEvent);
    await waitFor(() => expect(harness.api.startTurn).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.api.speakText).not.toHaveBeenCalled();
    expect(harness.api.livePlaybackEnded).not.toHaveBeenCalled();
    expect(harness.api.livePlaybackStarted).not.toHaveBeenCalled();
  });
});
