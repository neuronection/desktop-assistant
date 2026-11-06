import { RecordingManager } from '@renderer/managers/RecordingManager';
import { createSpeechQueue } from '@renderer/chat-react/speechQueue';
import { detectFullDuplexOutput } from '@renderer/shared/detectFullDuplex';
import { splitSpeechChunks } from '@shared/text/speech-chunks';
import { LIVE_SPOKEN_MAX_CHARS, type LiveState } from '@shared/live';
import { TEXT } from '@shared/constants/text';

interface StartPayload {
  bargeInOnSpeakers: boolean;
  spokenMaxChars: number;
  /** E2E seam for the failure handoff (never set in normal runs). */
  failure?: 'mic_denied';
}

interface SpeakPayload {
  session: number;
  generation: number;
  text: string;
}

let liveState: LiveState = 'idle';
let liveSession = 0;
let captureOpen = false;
let captureStarted = false;
let speakGeneration = 0;
let currentChunk = '';
let spokenMaxChars = LIVE_SPOKEN_MAX_CHARS;
let ttsSeq = 0;
const inFlightTts = new Set<string>();
const queue = createSpeechQueue();

function recorder(): RecordingManager | null {
  try {
    return RecordingManager.getInstance();
  } catch {
    return null;
  }
}

function stopPlayback(): void {
  speakGeneration += 1;
  for (const id of inFlightTts) {
    void window.electronAPI.cancelAudioOp(id).catch(() => undefined);
  }
  inFlightTts.clear();
  queue.stop();
  currentChunk = '';
}

function closeMic(): void {
  captureStarted = false;
  captureOpen = false;
  const instance = recorder();
  if (!instance) {
    return;
  }
  try {
    instance.setLiveProfile(false);
    instance.cancelRecording();
  } catch {
    // the recorder is already torn down
  }
}

async function openMic(payload: StartPayload): Promise<void> {
  spokenMaxChars = payload.spokenMaxChars;
  stopPlayback();
  if (payload.failure === 'mic_denied') {
    window.electronAPI.liveFail('mic_denied');
    return;
  }
  const instance = recorder();
  if (!instance) {
    window.electronAPI.liveFail('mic_denied');
    return;
  }
  try {
    instance.setLiveProfile(true);
    instance.setCaptureEnabled(true);
    await instance.startRecording();
  } catch {
    window.electronAPI.liveFail('mic_denied');
    return;
  }
  captureStarted = true;
  captureOpen = true;
  window.electronAPI.liveMicReady();
  const fullDuplex = await detectFullDuplexOutput(payload.bargeInOnSpeakers);
  if (!fullDuplex) {
    window.electronAPI.liveDowngrade();
  }
}

async function speak(payload: SpeakPayload): Promise<void> {
  if (payload.session !== liveSession) {
    return;
  }
  const generation = (speakGeneration += 1);
  const clean = payload.text.trim();
  if (!clean) {
    if (generation === speakGeneration) {
      window.electronAPI.livePlaybackEnded();
    }
    return;
  }
  const cap = spokenMaxChars;
  const truncated = cap > 0 && clean.length > cap;
  const chunks = splitSpeechChunks(truncated ? clean.slice(0, cap) : clean);
  if (truncated) {
    chunks.push(TEXT.LIVE_LONG_REPLY_NOTICE);
  }
  let started = false;
  try {
    await queue.play(
      chunks,
      async (chunk) => {
        const id = `live-tts-${Date.now().toString(36)}-${(ttsSeq += 1)}`;
        inFlightTts.add(id);
        try {
          const audio = await window.electronAPI.synthesizeTts(chunk, false, id);
          return audio ? `data:${audio.mime};base64,${audio.audioBase64}` : null;
        } catch {
          return null;
        } finally {
          inFlightTts.delete(id);
        }
      },
      (chunk) => {
        if (generation !== speakGeneration) {
          return;
        }
        currentChunk = chunk;
        if (!started) {
          started = true;
          window.electronAPI.livePlaybackStarted();
        }
      }
    );
  } catch (error) {
    console.error('live host TTS failed:', error);
    window.electronAPI.liveWarning('tts_failed');
  } finally {
    if (generation === speakGeneration) {
      currentChunk = '';
      window.electronAPI.livePlaybackEnded();
    }
  }
}

function applyCaptureState(): void {
  const instance = recorder();
  if (!instance || !captureStarted) {
    return;
  }
  const shouldCapture = liveState !== 'idle' && liveState !== 'error' && captureOpen;
  try {
    instance.setCaptureEnabled(shouldCapture);
  } catch {
    // the recorder is already torn down
  }
  if (liveState === 'idle' || liveState === 'error') {
    stopPlayback();
  }
  if (liveState === 'error') {
    closeMic();
  }
}

function subscribeRecorder(): void {
  const instance = recorder();
  if (!instance) {
    return;
  }
  let lastLevelAt = 0;
  instance.on('volume:change', (volume: number) => {
    if (!captureStarted || !captureOpen) {
      return;
    }
    const now = performance.now();
    if (now - lastLevelAt < 50) {
      return;
    }
    lastLevelAt = now;
    window.electronAPI.liveLevel(Math.max(0, Math.min(1, volume)));
  });
  instance.on('transcript:received', (text: string) => {
    if (!captureStarted) {
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (liveState === 'listening') {
      window.electronAPI.livePhraseCommitted(trimmed);
    } else if (liveState === 'speaking' || liveState === 'preparing') {
      window.electronAPI.liveSpeechDetected({ transcript: trimmed, currentSentence: currentChunk });
    }
  });
  instance.on('transcript:error', () => {
    if (captureStarted) {
      window.electronAPI.liveWarning('stt_failed');
    }
  });
  instance.on('recording:error', () => {
    if (captureStarted) {
      window.electronAPI.liveFail('mic_lost');
    }
  });
}

function watchDevices(): void {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.addEventListener) {
    return;
  }
  mediaDevices.addEventListener('devicechange', () => {
    if (!captureStarted) {
      return;
    }
    void mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (!devices.some((device) => device.kind === 'audioinput')) {
          window.electronAPI.liveFail('mic_lost');
        }
      })
      .catch(() => undefined);
  });
}

window.electronAPI.onLiveEvent((event) => {
  if (event.type === 'state') {
    liveState = event.snapshot.state;
    liveSession = event.snapshot.session;
    captureOpen = event.snapshot.capture === 'open';
    applyCaptureState();
  } else if (event.type === 'stop') {
    stopPlayback();
  } else if (event.type === 'duck') {
    queue.duck(event.on);
  } else if (event.type === 'ended') {
    stopPlayback();
    closeMic();
    liveState = 'idle';
  }
});

window.electronAPI.onLiveHostStart((payload) => {
  if (payload) {
    void openMic(payload);
  }
});
window.electronAPI.onLiveHostStop(() => {
  stopPlayback();
  closeMic();
  liveState = 'idle';
});
window.electronAPI.onLiveHostSpeak((payload) => {
  if (payload) {
    void speak(payload);
  }
});

subscribeRecorder();
watchDevices();

window.electronAPI.liveHostReady();
