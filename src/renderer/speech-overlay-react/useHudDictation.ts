import { useCallback, useEffect, useRef, useState } from 'react';
import { TEXT } from '@shared/constants/text';
import { RecordingState } from '@shared/types';
import type { TurnEvent } from '@shared/turns';
import { RecordingManager } from '@renderer/managers/RecordingManager';
import { speechTextFromMarkdown } from '@renderer/chat-react/speechText';

export type HudDictationState =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'transcribing'
  | 'thinking'
  | 'streaming'
  | 'error';

export interface HudDictationOptions {
  enabled: boolean;
  resultAutoHideMs?: number;
}

export interface HudDictation {
  state: HudDictationState;
  active: boolean;
  text: string;
  micLevel: number;
  start: () => Promise<void>;
  send: () => Promise<void>;
  cancel: () => void;
}

const SPEAK_LIMIT = 20_000;

function getRecorder(): RecordingManager | null {
  try {
    return RecordingManager.getInstance();
  } catch {
    return null;
  }
}

function mergeTranscript(previous: string, next: string): string {
  const earlier = previous.trim();
  const latest = next.trim();
  if (!earlier) {
    return latest;
  }
  if (!latest || earlier === latest || earlier.endsWith(latest)) {
    return earlier;
  }
  if (latest.startsWith(earlier)) {
    return latest;
  }
  return `${earlier} ${latest}`;
}

export function useHudDictation({
  enabled,
  resultAutoHideMs = 10_000,
}: HudDictationOptions): HudDictation {
  const [state, setState] = useState<HudDictationState>('idle');
  const [text, setText] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const stateRef = useRef<HudDictationState>('idle');
  const enabledRef = useRef(enabled);
  const resultAutoHideRef = useRef(resultAutoHideMs);
  const interimRef = useRef('');
  const transcriptRef = useRef('');
  const replyRef = useRef('');
  const conversationRef = useRef<string | null>(null);
  const tempRef = useRef<string | null>(null);
  const manualStopRef = useRef(false);
  const generationRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    resultAutoHideRef.current = resultAutoHideMs;
  }, [resultAutoHideMs]);

  const clearHideTimer = useCallback((): void => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const setPhase = useCallback((next: HudDictationState): void => {
    stateRef.current = next;
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const setDockText = useCallback((next: string): void => {
    if (mountedRef.current) {
      setText(next);
    }
  }, []);

  const showError = useCallback(
    (message: string): void => {
      setPhase('error');
      setDockText(message);
      setMicLevel(0);
      clearHideTimer();
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        if (mountedRef.current && stateRef.current === 'error') {
          setPhase('idle');
          setDockText('');
        }
      }, 4_000);
    },
    [clearHideTimer, setDockText, setPhase]
  );

  useEffect(() => {
    const recorder = getRecorder();
    if (!recorder) {
      return undefined;
    }
    const onVolume = (level: number): void => {
      if (stateRef.current === 'recording') {
        setMicLevel(Math.max(0, Math.min(1, level)));
      }
    };
    const onInterim = (next: string): void => {
      if (stateRef.current !== 'recording') {
        return;
      }
      interimRef.current = next;
      setDockText(next);
    };
    const onTranscript = (next: string): void => {
      if (manualStopRef.current || stateRef.current !== 'recording') {
        return;
      }
      const trimmed = next.trim();
      if (!trimmed) {
        return;
      }
      const merged = mergeTranscript(interimRef.current, trimmed);
      transcriptRef.current = merged;
      setDockText(merged);
      setPhase('ready');
      setMicLevel(0);
    };
    const onError = (): void => {
      if (manualStopRef.current) {
        return;
      }
      if (stateRef.current === 'recording' || stateRef.current === 'transcribing') {
        showError(TEXT.HUB_DICTATION_FAILED);
      }
    };
    const onState = (next: RecordingState): void => {
      if (next !== RecordingState.RECORDING) {
        setMicLevel(0);
      }
      if (
        next === RecordingState.IDLE &&
        stateRef.current === 'recording' &&
        !manualStopRef.current &&
        !transcriptRef.current
      ) {
        showError(TEXT.HUB_DICTATION_EMPTY);
      }
    };
    recorder.on('volume:change', onVolume);
    recorder.on('interim:transcript', onInterim);
    recorder.on('transcript:received', onTranscript);
    recorder.on('recording:error', onError);
    recorder.on('transcript:error', onError);
    recorder.on('state:change', onState);
    return () => {
      recorder.off('volume:change', onVolume);
      recorder.off('interim:transcript', onInterim);
      recorder.off('transcript:received', onTranscript);
      recorder.off('recording:error', onError);
      recorder.off('transcript:error', onError);
      recorder.off('state:change', onState);
    };
  }, [setDockText, setPhase, showError]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onTurnEvent) {
      return undefined;
    }
    return api.onTurnEvent((event: TurnEvent) => {
      if (!conversationRef.current || event.conversationId !== conversationRef.current) {
        return;
      }
      const phase = stateRef.current;
      if (phase !== 'thinking' && phase !== 'streaming') {
        return;
      }
      if (tempRef.current && tempRef.current !== event.tempMessageId) {
        return;
      }
      if (!tempRef.current) {
        tempRef.current = event.tempMessageId;
      }
      switch (event.phase) {
        case 'queued':
          setPhase('thinking');
          setDockText(TEXT.HUB_DICTATION_QUEUED);
          return;
        case 'thinking':
        case 'tool_call':
        case 'tool_result':
          setPhase('thinking');
          setDockText(TEXT.HUB_DICTATION_THINKING);
          return;
        case 'interrupt':
          setPhase('thinking');
          setDockText(TEXT.LIVE_HUD_APPROVAL);
          return;
        case 'streaming': {
          setPhase('streaming');
          replyRef.current += event.delta ?? '';
          setDockText(replyRef.current || TEXT.HUB_DICTATION_THINKING);
          return;
        }
        case 'finished': {
          const reply = replyRef.current.trim();
          const spoken = (event.speakText ?? reply).trim();
          const message = event.speakText ? event.speakText.trim() : reply;
          const dedupeKey = event.tempMessageId;
          conversationRef.current = null;
          tempRef.current = null;
          setMicLevel(0);
          setPhase('idle');
          setDockText(message);
          clearHideTimer();
          if (resultAutoHideRef.current > 0 && message) {
            hideTimer.current = setTimeout(() => {
              hideTimer.current = null;
              if (mountedRef.current && stateRef.current === 'idle') {
                setDockText('');
              }
            }, resultAutoHideRef.current);
          }
          if (spoken) {
            const speakable =
              event.speakText ? spoken : speechTextFromMarkdown(spoken);
            if (speakable) {
              void api
                .speakText?.({
                  text: speakable.slice(0, SPEAK_LIMIT),
                  source: 'reply',
                  dedupeKey,
                })
                .catch(() => undefined);
            }
          }
          return;
        }
        case 'failed':
          conversationRef.current = null;
          tempRef.current = null;
          showError(TEXT.HUB_DICTATION_FAILED);
          return;
        default:
          return;
      }
    });
  }, [clearHideTimer, setDockText, setPhase, showError]);

  const start = useCallback(async (): Promise<void> => {
    if (!enabledRef.current) {
      return;
    }
    const current = stateRef.current;
    if (
      current === 'recording' ||
      current === 'ready' ||
      current === 'transcribing' ||
      current === 'thinking' ||
      current === 'streaming'
    ) {
      return;
    }
    const recorder = getRecorder();
    if (!recorder) {
      showError(TEXT.HUB_DICTATION_FAILED);
      return;
    }
    try {
      const config = await window.electronAPI?.loadConfig?.();
      if (!config?.voice?.enabled || !config?.taskAssignments?.stt) {
        showError(TEXT.HUB_DICTATION_UNAVAILABLE);
        return;
      }
    } catch {
      showError(TEXT.HUB_DICTATION_UNAVAILABLE);
      return;
    }
    if (!enabledRef.current || document.visibilityState === 'hidden') {
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    manualStopRef.current = false;
    interimRef.current = '';
    transcriptRef.current = '';
    replyRef.current = '';
    conversationRef.current = null;
    tempRef.current = null;
    clearHideTimer();
    setPhase('recording');
    setDockText(TEXT.HUB_DICTATION_LISTENING);
    setMicLevel(0);
    recorder.setLiveProfile(false);
    recorder.setCaptureEnabled(true);
    try {
      await recorder.startRecording();
    } catch {
      if (generation === generationRef.current) {
        showError(TEXT.HUB_DICTATION_FAILED);
      }
    }
  }, [clearHideTimer, setDockText, setPhase, showError]);

  const send = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current !== 'recording' && current !== 'ready') {
      return;
    }
    const generation = generationRef.current;
    let transcript = (transcriptRef.current || interimRef.current).trim();
    if (current === 'recording') {
      const recorder = getRecorder();
      manualStopRef.current = true;
      setPhase('transcribing');
      setDockText(TEXT.VOICE_TRANSCRIBING);
      setMicLevel(0);
      try {
        const stopped = await recorder?.stopRecording();
        if (generation !== generationRef.current) {
          return;
        }
        transcript = mergeTranscript(interimRef.current, stopped ?? transcript);
      } catch {
        if (generation === generationRef.current) {
          showError(TEXT.HUB_DICTATION_FAILED);
        }
        return;
      } finally {
        manualStopRef.current = false;
      }
    }
    if (generation !== generationRef.current) {
      return;
    }
    if (!transcript) {
      showError(TEXT.HUB_DICTATION_EMPTY);
      return;
    }
    const api = window.electronAPI;
    if (!api?.startTurn || !api.getAllConversations || !api.createConversation) {
      showError(TEXT.HUB_DICTATION_FAILED);
      return;
    }
    setPhase('thinking');
    setDockText(TEXT.HUB_DICTATION_THINKING);
    replyRef.current = '';
    try {
      const conversations = (await api.getAllConversations()) ?? [];
      let conversation = conversations.find(
        (entry) => entry?.title === TEXT.HUB_VOICE_CONVERSATION_TITLE
      );
      if (!conversation?.id) {
        conversation = await api.createConversation(TEXT.HUB_VOICE_CONVERSATION_TITLE);
      }
      if (!conversation?.id) {
        throw new Error('Conversation unavailable');
      }
      conversationRef.current = conversation.id;
      const result = await api.startTurn({
        conversationId: conversation.id,
        content: transcript,
      });
      if (generation !== generationRef.current) {
        return;
      }
      if (!tempRef.current) {
        tempRef.current = result.tempMessageId;
      }
      if (result.queued) {
        setDockText(TEXT.HUB_DICTATION_QUEUED);
      }
    } catch (error) {
      if (generation === generationRef.current) {
        conversationRef.current = null;
        tempRef.current = null;
        const message = error instanceof Error ? error.message : '';
        showError(
          /already in progress|busy/i.test(message)
            ? TEXT.HUB_DICTATION_BUSY
            : TEXT.HUB_DICTATION_FAILED
        );
      }
    }
  }, [setDockText, setPhase, showError]);

  const cancel = useCallback((): void => {
    const current = stateRef.current;
    const active =
      current === 'recording' || current === 'ready' || current === 'transcribing';
    if (!active) {
      if (current === 'thinking' || current === 'streaming') {
        return;
      }
      clearHideTimer();
      setMicLevel(0);
      setPhase('idle');
      setDockText('');
      return;
    }
    generationRef.current += 1;
    getRecorder()?.cancelRecording();
    manualStopRef.current = false;
    interimRef.current = '';
    transcriptRef.current = '';
    replyRef.current = '';
    conversationRef.current = null;
    tempRef.current = null;
    clearHideTimer();
    setMicLevel(0);
    setPhase('idle');
    setDockText('');
  }, [clearHideTimer, setDockText, setPhase]);

  useEffect(() => {
    const busy =
      state === 'recording' ||
      state === 'ready' ||
      state === 'transcribing' ||
      state === 'thinking' ||
      state === 'streaming';
    window.electronAPI?.setHudBusy?.(busy);
    return () => {
      window.electronAPI?.setHudBusy?.(false);
    };
  }, [state]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        cancel();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancel]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearHideTimer();
      getRecorder()?.cancelRecording();
    };
  }, [clearHideTimer]);

  const active =
    state === 'recording' || state === 'ready' || state === 'transcribing';
  return { state, active, text, micLevel, start, send, cancel };
}
