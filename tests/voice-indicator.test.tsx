// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { VoiceIndicator } from '@renderer/chat-react/VoiceIndicator';
import { Composer } from '@renderer/chat-react/Composer';
import { RecordingManager } from '@renderer/managers/RecordingManager';
import { ChatApp } from '@renderer/chat-react/ChatApp';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
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

afterEach(() => {
  cleanup();
  (RecordingManager as unknown as { instance?: unknown }).instance = undefined;
});

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact ?? 'unknown'}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('VoiceIndicator', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<VoiceIndicator state="idle" level={0.5} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows pulsing bars and the listening label while recording', () => {
    const { container } = render(<VoiceIndicator state="recording" level={0.6} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(TEXT.VOICE_LISTENING)).toBeTruthy();
    expect(container.querySelectorAll('.da-voice-bar').length).toBe(5);
  });

  it('bar height follows the audio level', () => {
    const { container, rerender } = render(<VoiceIndicator state="recording" level={0.05} />);
    const bar = () => container.querySelectorAll('.da-voice-bar')[2] as HTMLElement;
    const quiet = parseFloat(bar().style.height);
    rerender(<VoiceIndicator state="recording" level={0.95} />);
    const loud = parseFloat(bar().style.height);
    expect(loud).toBeGreaterThan(quiet);
  });

  it('shows the transcribing label while processing', () => {
    render(<VoiceIndicator state="transcribing" level={0} />);
    expect(screen.getByText(TEXT.VOICE_TRANSCRIBING)).toBeTruthy();
  });

  it('shows the full pending transcription while recording', () => {
    const longText = 'first words ' + 'middle of the dictation '.repeat(6) + 'the newest words';
    render(<VoiceIndicator state="recording" level={0.5} interim={longText} />);
    expect(screen.getByText(longText)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(longText);
  });

  it('has no axe violations while recording', async () => {
    const { container } = render(<VoiceIndicator state="recording" level={0.5} />);
    await expectNoViolations(container);
  });

  it('has no axe violations while transcribing', async () => {
    const { container } = render(<VoiceIndicator state="transcribing" level={0} />);
    await expectNoViolations(container);
  });
});

describe('Composer voice surface', () => {
  function renderComposer(voiceState: 'idle' | 'recording' | 'transcribing'): HTMLElement {
    const { container } = render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        voiceState={voiceState}
        voiceLevel={0.4}
        textareaRef={{ current: null }}
      />
    );
    return container;
  }

  it('shows the indicator inside the composer while recording', () => {
    renderComposer('recording');
    expect(screen.getByText(TEXT.VOICE_LISTENING)).toBeTruthy();
  });

  it('renders no indicator when idle', () => {
    renderComposer('idle');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers cancel while recording and forwards it', () => {
    const onCancel = vi.fn();
    render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        onCancelRecording={onCancel}
        voiceState="recording"
        voiceLevel={0.4}
        textareaRef={{ current: null }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_CANCEL }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clears pending text without hiding the recording controls', () => {
    const onClear = vi.fn();
    render(
      <Composer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        sending={false}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onAttachFiles={() => {}}
        onPickScreen={() => {}}
        onToggleRecording={() => {}}
        onCancelRecording={() => {}}
        onClearInterim={onClear}
        voiceState="recording"
        voiceLevel={0.4}
        voiceInterim="some pending words"
        textareaRef={{ current: null }}
      />
    );
    expect(screen.getByText('some pending words')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_CLEAR_PENDING }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables the mic while transcribing and offers stop while recording', () => {
    renderComposer('transcribing');
    const mic = screen.getByTitle(TEXT.COMPOSER_VOICE_INPUT) as HTMLButtonElement;
    expect(mic.disabled).toBe(true);

    cleanup();
    renderComposer('recording');
    const stop = screen.getByTitle(TEXT.COMPOSER_STOP_RECORDING) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
  });

  it('has no axe violations with the voice surface active', async () => {
    const container = renderComposer('recording');
    await expectNoViolations(container);
  });
});

const ACTIVE_CONV = {
  id: 'conv-1',
  title: 'Test',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  isArchived: false,
};

class FakeMediaRecorder {
  static isTypeSupported = (): boolean => true;
  static nextTag = 0;
  readonly tag: string;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(_stream: unknown, _options: unknown) {
    this.tag = `chunk-${++FakeMediaRecorder.nextTag}`;
  }
  start(): void {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob([`${this.tag}-live`]) });
  }
  stop(): void {
    this.state = 'inactive';
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([`${this.tag}-final`]) });
      this.onstop?.();
    }, 0);
  }
}

class FakeAudioContext {
  static level = 128;
  state = 'running';
  createAnalyser = (): { fftSize: number; getByteTimeDomainData: (a: Uint8Array) => void } => ({
    fftSize: 256,
    getByteTimeDomainData: (a: Uint8Array): void => {
      a.fill(FakeAudioContext.level);
    },
  });
  createMediaStreamSource = (): { connect: () => void } => ({ connect: () => {} });
  decodeAudioData = async (buffer: ArrayBuffer): Promise<AudioBuffer> =>
    ({ numberOfChannels: 1, sampleRate: 16000, length: 4, getChannelData: () => new Float32Array(4) }) as unknown as AudioBuffer;
  close = async (): Promise<void> => {
    this.state = 'closed';
  };
}

function stubVoiceEnvironment(): void {
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: () => {} }] })),
    },
  });
}

describe('voice auto-send', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeMediaRecorder.nextTag = 0;
    FakeAudioContext.level = 128;
    (RecordingManager as unknown as { instance?: unknown }).instance = undefined;
    stubVoiceEnvironment();
  });

  function mockChatApi(overrides: Record<string, unknown> = {}): {
    startTurn: ReturnType<typeof vi.fn>;
    evaluateUtterance: ReturnType<typeof vi.fn>;
    fireTurnEvent: (event: Record<string, unknown>) => void;
  } {
    const startTurn = vi.fn(async () => ({ tempMessageId: 'turn_1' }));
    const evaluateUtterance = vi.fn(async () => ({ complete: true }));
    let turnHandler: ((event: Record<string, unknown>) => void) | null = null;
    const onTurnEvent = vi.fn((cb: (event: Record<string, unknown>) => void) => {
      turnHandler = cb;
      return () => {};
    });
    window.electronAPI = {
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: 'whisper-1', voiceEndpoint: 'mini' },
        voice: { ...DEFAULT_CONFIG.voice, liveTranscript: true, phraseGapMs: 60, autoSend: true },
      }) as AppConfig),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => ({ ...ACTIVE_CONV, messages: [] })),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent,
      startTurn,
      cancelTurn: vi.fn(async () => true),
      resumeTurn: vi.fn(async () => true),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn(() => () => {}),
      onFocusInput: vi.fn(() => () => {}),
      getScreenSources: vi.fn(async () => []),
      setConversationMetadata: vi.fn(async () => {}),
      sttTranscribe: vi.fn(async () => 'seg one'),
      evaluateUtterance,
      ...overrides,
    } as unknown as typeof window.electronAPI;
    return {
      startTurn,
      evaluateUtterance,
      fireTurnEvent: (event: Record<string, unknown>) => turnHandler?.(event),
    };
  }

  it('sends a completed dictation without pressing Enter', async () => {
    const { startTurn } = mockChatApi();

    render(<ChatApp onThemeChange={() => {}} />);
    const mic = await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    FakeAudioContext.level = 218;
    fireEvent.click(mic);
    await new Promise((resolve) => setTimeout(resolve, 400));

    FakeAudioContext.level = 128;
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ content: 'seg one' })), { timeout: 4000 });
    expect(screen.queryByTitle(TEXT.COMPOSER_STOP_RECORDING)).toBeNull();
  });

  it('streams the auto-sent response into the launcher panel', async () => {
    const { startTurn, fireTurnEvent } = mockChatApi();

    render(<ChatApp onThemeChange={() => {}} />);
    const mic = await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    FakeAudioContext.level = 218;
    fireEvent.click(mic);
    await new Promise((resolve) => setTimeout(resolve, 400));

    FakeAudioContext.level = 128;
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalled(), { timeout: 4000 });
    expect(document.body.textContent).not.toContain('Berlin looks lovely today');

    fireTurnEvent({ tempMessageId: 'turn_1', conversationId: 'conv-1', seq: 2, phase: 'streaming', delta: 'Berlin looks lovely today' });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Berlin looks lovely today'), { timeout: 4000 });
    expect(screen.queryByTitle(TEXT.COMPOSER_STOP_RECORDING)).toBeNull();
  });

  it('drags the window by the expanded panel header background', async () => {
    const moveWindowBy = vi.fn(async () => {});
    mockChatApi({ moveWindowBy });

    render(<ChatApp onThemeChange={() => {}} />);
    await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    fireEvent.keyDown(document, { key: 'e', ctrlKey: true });
    await screen.findByText('Conversation');

    const header = document.querySelector('[data-as="chat-panel-header"]') as HTMLElement;
    expect(header).toBeTruthy();

    const title = header.querySelector('.truncate') as HTMLElement;
    fireEvent.pointerDown(title, { button: 0, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 45 });
    fireEvent.pointerUp(window);

    expect(moveWindowBy).toHaveBeenCalledWith(60, 25);
    moveWindowBy.mockClear();

    const button = header.querySelector('button') as HTMLElement;
    fireEvent.pointerDown(button, { button: 0, clientX: 300, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 60 });
    fireEvent.pointerUp(window);
    expect(moveWindowBy).not.toHaveBeenCalled();
  });

  it('keeps dictating when the endpoint model judges the phrase incomplete', async () => {
    const { startTurn, evaluateUtterance } = mockChatApi();
    evaluateUtterance.mockResolvedValue({ complete: false });

    render(<ChatApp onThemeChange={() => {}} />);
    const mic = await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    FakeAudioContext.level = 218;
    fireEvent.click(mic);
    await new Promise((resolve) => setTimeout(resolve, 400));

    FakeAudioContext.level = 128;
    await vi.waitFor(() => expect(evaluateUtterance).toHaveBeenCalled(), { timeout: 4000 });
    expect(screen.getByTitle(TEXT.COMPOSER_STOP_RECORDING)).toBeTruthy();
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('never evaluates when auto-send is off', async () => {
    const { startTurn, evaluateUtterance } = mockChatApi({
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: 'whisper-1', voiceEndpoint: 'mini' },
        voice: { ...DEFAULT_CONFIG.voice, liveTranscript: true, phraseGapMs: 60, autoSend: false },
      }) as AppConfig),
    });

    render(<ChatApp onThemeChange={() => {}} />);
    const mic = await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    FakeAudioContext.level = 218;
    fireEvent.click(mic);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(evaluateUtterance).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe('voice error surfacing', () => {
  it('microphone failures surface as a chat error notice', async () => {
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error('no microphone in jsdom');
        }),
      },
    });
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: class {
        static isTypeSupported = (): boolean => true;
        state = 'inactive';
        mimeType = 'audio/webm';
        ondataavailable: ((event: unknown) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        start(): void {}
        stop(): void {}
      },
    });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {} });

    window.electronAPI = {
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: 'whisper-1' },
      }) as AppConfig),
      onConfigUpdate: vi.fn(() => () => {}),
      getConversationById: vi.fn(async () => ({ ...ACTIVE_CONV, messages: [] })),
      getAllConversations: vi.fn(async () => [ACTIVE_CONV]),
      onTurnEvent: vi.fn(() => () => {}),
      startTurn: vi.fn(async () => ({ tempMessageId: 'turn_1' })),
      cancelTurn: vi.fn(async () => true),
      resumeTurn: vi.fn(async () => true),
      hideWindow: vi.fn(),
      openDesktop: vi.fn(async () => {}),
      resizeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      onSettingsOpen: vi.fn(async () => {}),
      onLauncherToggleExpand: vi.fn(() => () => {}),
      onFocusInput: vi.fn(() => () => {}),
      getScreenSources: vi.fn(async () => []),
      setConversationMetadata: vi.fn(async () => {}),
    } as unknown as typeof window.electronAPI;

    render(<ChatApp onThemeChange={() => {}} />);
    const mic = await screen.findByTitle(TEXT.COMPOSER_VOICE_INPUT);
    fireEvent.click(mic);

    await waitFor(() => expect(screen.getByText(/Voice input failed/)).toBeTruthy());
    expect(screen.getByText(/no microphone in jsdom/)).toBeTruthy();
  });
});
