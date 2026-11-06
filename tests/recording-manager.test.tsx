// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordingManager } from '@renderer/managers/RecordingManager';
import { AppConfig, DEFAULT_CONFIG } from '@shared/config/AppConfig';

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
  static decoded: string[] = [];
  static level = 128;
  static script: number[] = [];
  static samples = 0;
  state = 'running';
  closed = 0;
  createAnalyser = (): { fftSize: number; getByteTimeDomainData: (array: Uint8Array) => void } => ({
    fftSize: 256,
    getByteTimeDomainData: (array: Uint8Array): void => {
      const level = FakeAudioContext.script.length > 0 ? FakeAudioContext.script.shift()! : FakeAudioContext.level;
      FakeAudioContext.samples += 1;
      array.fill(level);
    },
  });
  createMediaStreamSource = (): { connect: () => void } => ({ connect: () => {} });
  decodeAudioData = async (buffer: ArrayBuffer): Promise<AudioBuffer> => {
    FakeAudioContext.decoded.push(new TextDecoder().decode(buffer));
    return {
      numberOfChannels: 1,
      sampleRate: 16000,
      length: 4,
      getChannelData: (): Float32Array => new Float32Array(4),
    } as unknown as AudioBuffer;
  };
  close = async (): Promise<void> => {
    this.closed += 1;
    this.state = 'closed';
  };
}

const SILENCE_BYTE = 128;
const SPEECH_BYTE = 218;

const audioTrack = { enabled: true, stop: (): void => trackStopSpy() };

const fakeStream = (): MediaStream =>
  ({
    getTracks: (): Array<{ stop: () => void }> => [{ stop: () => trackStopSpy() }],
    getAudioTracks: (): Array<{ enabled: boolean }> => [audioTrack],
  }) as unknown as MediaStream;

const trackStopSpy = vi.fn();

let manualRafQueue: FrameRequestCallback[] = [];

function installManualRaf(): void {
  manualRafQueue = [];
  window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    manualRafQueue.push(callback);
    return manualRafQueue.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (): void => {};
}

function tickFrames(count = 1): void {
  for (let index = 0; index < count; index += 1) {
    const callbacks = manualRafQueue;
    manualRafQueue = [];
    callbacks.forEach((callback) => callback(performance.now()));
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeMediaRecorder.nextTag = 0;
  FakeAudioContext.decoded = [];
  FakeAudioContext.level = SILENCE_BYTE;
  FakeAudioContext.script = [];
  FakeAudioContext.samples = 0;
  installManualRaf();
  trackStopSpy.mockClear();
  Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  });
  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: 'whisper-1' },
    voice: { ...DEFAULT_CONFIG.voice, liveTranscript: true, phraseGapMs: 60 },
  };
  window.electronAPI = {
    loadConfig: vi.fn(async () => config),
    sttTranscribe: vi.fn(async () => 'transcript'),
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  (RecordingManager as unknown as { instance?: RecordingManager }).instance = undefined;
});

describe('RecordingManager consecutive recordings', () => {
  it('keeps each recording final chunk in its own blob (no cross-recording bleed)', async () => {
    const recorder = RecordingManager.getInstance();
    FakeAudioContext.script = Array(24).fill(SPEECH_BYTE);

    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    tickFrames(24);
    const first = await recorder.stopRecording();
    expect(first).toBeTruthy();

    FakeAudioContext.script = Array(24).fill(SPEECH_BYTE);
    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    tickFrames(24);
    const second = await recorder.stopRecording();
    expect(second).toBeTruthy();

    expect(FakeAudioContext.decoded[0]).toBe('chunk-1-livechunk-1-final');
    expect(FakeAudioContext.decoded[1]).toBe('chunk-2-livechunk-2-final');
    expect(FakeAudioContext.decoded[1]).not.toContain('chunk-1');
  });

  it('releases the microphone and resets state after a normal stop', async () => {
    const recorder = RecordingManager.getInstance();

    await recorder.startRecording();
    await recorder.stopRecording();

    expect(trackStopSpy).toHaveBeenCalled();
    expect(recorder.getState()).toBe('idle');
    expect(recorder.isRecording()).toBe(false);
    expect(recorder.isProcessing()).toBe(false);
  });

  it('mutes and unmutes the capture track', async () => {
    const recorder = RecordingManager.getInstance();
    await recorder.startRecording();
    recorder.setCaptureEnabled(false);
    expect(audioTrack.enabled).toBe(false);
    recorder.setCaptureEnabled(true);
    expect(audioTrack.enabled).toBe(true);
    recorder.cancelRecording();
  });

  it('re-enables capture after a recording that muted it (live-session leak)', async () => {
    const recorder = RecordingManager.getInstance();
    await recorder.startRecording();
    recorder.setCaptureEnabled(false);
    recorder.cancelRecording();
    await recorder.startRecording();
    expect(audioTrack.enabled).toBe(true);
    recorder.cancelRecording();
  });

  it('live-transcribes each paused phrase while recording continues', async () => {
    const sttTranscribe = window.electronAPI.sttTranscribe as ReturnType<typeof vi.fn>;
    sttTranscribe.mockReset();
    sttTranscribe.mockResolvedValueOnce('seg one').mockResolvedValueOnce('seg two');

    const recorder = RecordingManager.getInstance();
    const interims: string[] = [];
    recorder.on('interim:transcript', (text) => interims.push(text));

    FakeAudioContext.script = [...Array(24).fill(SPEECH_BYTE), ...Array(100).fill(SILENCE_BYTE)];
    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    tickFrames(30);
    await vi.waitFor(() => expect(interims).toEqual(['seg one']), { timeout: 10_000 });
    await vi.waitFor(() => expect(FakeMediaRecorder.nextTag).toBeGreaterThanOrEqual(2), { timeout: 10_000 });

    FakeAudioContext.script = [...Array(24).fill(SPEECH_BYTE), ...Array(100).fill(SILENCE_BYTE)];
    tickFrames(30);
    await vi.waitFor(() => expect(interims).toEqual(['seg one', 'seg one seg two']), { timeout: 10_000 });

    const final = await recorder.stopRecording();

    expect(final).toBe('seg one seg two');
    expect(recorder.isRecording()).toBe(false);
    expect(trackStopSpy).toHaveBeenCalled();
    expect(FakeAudioContext.decoded.length).toBeGreaterThanOrEqual(2);
  });

  it('cancel discards audio without any STT call and releases the mic', async () => {
    const sttTranscribe = window.electronAPI.sttTranscribe as ReturnType<typeof vi.fn>;
    sttTranscribe.mockReset();
    sttTranscribe.mockResolvedValue('should never appear');

    const recorder = RecordingManager.getInstance();
    const interims: string[] = [];
    recorder.on('interim:transcript', (text) => interims.push(text));

    FakeAudioContext.level = SPEECH_BYTE;
    await recorder.startRecording();
    recorder.cancelRecording();

    expect(recorder.getState()).toBe('idle');
    expect(recorder.isRecording()).toBe(false);
    expect(trackStopSpy).toHaveBeenCalled();
    expect(sttTranscribe).not.toHaveBeenCalled();
    expect(interims).toEqual([]);
  });
});

describe('silence handling', () => {
  it('clearInterim resets the accumulated transcript while recording continues', async () => {
    const sttTranscribe = window.electronAPI.sttTranscribe as ReturnType<typeof vi.fn>;
    sttTranscribe.mockReset();
    sttTranscribe.mockResolvedValueOnce('seg one').mockResolvedValueOnce('seg two');

    const recorder = RecordingManager.getInstance();
    const interims: string[] = [];
    recorder.on('interim:transcript', (text) => interims.push(text));

    FakeAudioContext.script = [...Array(24).fill(SPEECH_BYTE), ...Array(100).fill(SILENCE_BYTE)];
    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    tickFrames(30);
    await vi.waitFor(() => expect(interims).toEqual(['seg one']), { timeout: 10_000 });

    recorder.clearInterim();

    FakeAudioContext.script = [...Array(24).fill(SPEECH_BYTE), ...Array(100).fill(SILENCE_BYTE)];
    tickFrames(30);
    await vi.waitFor(() => expect(interims).toEqual(['seg one', 'seg two']), { timeout: 10_000 });

    const final = await recorder.stopRecording();
    expect(final).toBe('seg two');
  });

  it('keeps silence from producing empty interim segments', async () => {
    const sttTranscribe = window.electronAPI.sttTranscribe as ReturnType<typeof vi.fn>;
    sttTranscribe.mockReset();

    const recorder = RecordingManager.getInstance();
    const interims: string[] = [];
    recorder.on('interim:transcript', (text) => interims.push(text));

    FakeAudioContext.level = SILENCE_BYTE;
    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    tickFrames(20);

    expect(interims).toEqual([]);
    expect(sttTranscribe).not.toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(true);

    await recorder.stopRecording();
    expect(recorder.isRecording()).toBe(false);
  });

  it('force-commits a segment after the configured speech interval', async () => {
    const sttTranscribe = window.electronAPI.sttTranscribe as ReturnType<typeof vi.fn>;
    sttTranscribe.mockReset();
    sttTranscribe.mockResolvedValue('chunk text');

    window.electronAPI = {
      ...window.electronAPI,
      loadConfig: vi.fn(async () => ({
        ...DEFAULT_CONFIG,
        taskAssignments: { ...DEFAULT_CONFIG.taskAssignments, stt: 'whisper-1' },
        voice: { ...DEFAULT_CONFIG.voice, liveTranscript: true, phraseGapMs: 60000, maxSegmentMs: 400 },
      })) as unknown as typeof window.electronAPI.loadConfig,
    };

    const recorder = RecordingManager.getInstance();
    const interims: string[] = [];
    recorder.on('interim:transcript', (text) => interims.push(text));

    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    FakeAudioContext.script = Array(30).fill(SPEECH_BYTE);
    await recorder.startRecording();
    await vi.waitFor(() => expect(manualRafQueue.length).toBeGreaterThan(0));
    for (let index = 0; index < 30; index += 1) {
      now += 20;
      tickFrames(1);
    }

    await vi.waitFor(() => expect(interims.length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    nowSpy.mockRestore();
    expect(recorder.isRecording()).toBe(true);

    await recorder.stopRecording();
    expect(recorder.isRecording()).toBe(false);
  });
});