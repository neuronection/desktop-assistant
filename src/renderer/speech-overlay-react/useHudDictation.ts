import { useCallback, useEffect, useRef, useState } from 'react';
import { TEXT } from '@shared/constants/text';
import { RecordingState } from '@shared/types';
import type { DictationSnapshot } from '@shared/dictation';
import type { TurnEvent } from '@shared/turns';
import { RecordingManager } from '@renderer/managers/RecordingManager';

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
  /** The conversation the last reply landed in (home opens it expanded). */
  conversationId: string | null;
  /** The user's own words (the transcript), never the reply. */
  transcript: string;
  /**
   * What home carries into the launcher: an **unsent** transcript. Once the
   * turn is sent the question lives in the conversation, and pasting it into
   * the composer again would duplicate it.
   */
  handOffText: string;
  start: () => Promise<void>;
  /** Re-open the mic on the same session and append to what was already said. */
  resume: () => Promise<void>;
  send: () => Promise<void>;
  /** Stop and keep the transcript (ready to send) — the shared Stop button. */
  commit: () => Promise<void>;
  cancel: () => void;
}

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
  const [recorderState, setRecorderState] = useState<RecordingState>(RecordingState.IDLE);
  const [text, setText] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const stateRef = useRef<HudDictationState>('idle');
  const enabledRef = useRef(enabled);
  const resultAutoHideRef = useRef(resultAutoHideMs);
  const interimRef = useRef('');
  const transcriptRef = useRef('');
  const replyRef = useRef('');
  const conversationRef = useRef<string | null>(null);
  const [lastConversationId, setLastConversationId] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const tempRef = useRef<string | null>(null);
  const manualStopRef = useRef(false);
  const generationRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const lastLevelAt = useRef(0);

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

  /** The session is shared: every surface renders what main broadcasts. */
  const publish = useCallback((patch: Partial<DictationSnapshot>): void => {
    void window.electronAPI?.reportDictation?.(patch).catch(() => undefined);
  }, []);

  const endSession = useCallback((): void => {
    void window.electronAPI?.endDictation?.().catch(() => undefined);
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
      publish({ phase: 'error', error: message, level: 0 });
      clearHideTimer();
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        if (mountedRef.current && stateRef.current === 'error') {
          setPhase('idle');
          setDockText('');
          endSession();
        }
      }, 4_000);
    },
    [clearHideTimer, endSession, publish, setDockText, setPhase]
  );

  useEffect(() => {
    const recorder = getRecorder();
    if (!recorder) {
      return undefined;
    }
    const onVolume = (level: number): void => {
      if (stateRef.current !== 'recording') {
        return;
      }
      const next = Math.max(0, Math.min(1, level));
      setMicLevel(next);
      const now = Date.now();
      if (now - lastLevelAt.current >= 120) {
        lastLevelAt.current = now;
        publish({ level: next });
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
      setLastTranscript(merged);
      setDockText(merged);
      setPhase('ready');
      setMicLevel(0);
      publish({ phase: 'ready', interim: '', transcript: merged, level: 0 });
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
      setRecorderState(next);
      if (next !== RecordingState.RECORDING) {
        setMicLevel(0);
      }
      // The recorder is the source of truth: a session started elsewhere (or a
      // hook that missed the start) must still be visible as "listening".
      if (next === RecordingState.RECORDING && stateRef.current === 'idle') {
        setPhase('recording');
        setDockText('');
        publish({ phase: 'recording', level: 0 });
      }
      if (next === RecordingState.PROCESSING) {
        publish({ phase: 'transcribing', level: 0 });
      }
      if (next === RecordingState.IDLE && stateRef.current === 'recording' && !manualStopRef.current) {
        // The recorder stops itself on a real pause (dictation endpoint) and
        // has already published the phrase, so the HUD must land on the
        // transcript instead of staying "Listening…" forever.
        const text = transcriptRef.current.trim();
        if (text) {
          setPhase('ready');
          setDockText(text);
          publish({ phase: 'ready', interim: '', transcript: text });
        } else {
          showError(TEXT.HUB_DICTATION_EMPTY);
        }
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
  }, [publish, setDockText, setPhase, showError]);

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
          const message = event.speakText ? event.speakText.trim() : reply;
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

  /** Open the mic for this session: a fresh one, or a resume that keeps its text. */
  const openMic = useCallback(
    async (mode: 'fresh' | 'resume'): Promise<void> => {
      if (!enabledRef.current) {
        return;
      }
      const current = stateRef.current;
      if (mode === 'fresh') {
        if (
          current === 'recording' ||
          current === 'ready' ||
          current === 'transcribing' ||
          current === 'thinking' ||
          current === 'streaming'
        ) {
          return;
        }
      } else if (current !== 'ready') {
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
      if (mode === 'fresh') {
        // One session for every window: the launcher must not open a second mic.
        const begun = await window.electronAPI?.beginDictation?.('hud').catch(() => null);
        if (begun && begun.ok === false) {
          showError(TEXT.HUB_DICTATION_IN_USE);
          return;
        }
      }
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      manualStopRef.current = false;
      if (mode === 'fresh') {
        interimRef.current = '';
        transcriptRef.current = '';
        conversationRef.current = null;
        tempRef.current = null;
        replyRef.current = '';
      } else {
        // Keep the committed text as the base the next phrase appends to.
        interimRef.current = transcriptRef.current;
      }
      clearHideTimer();
      setPhase('recording');
      setDockText(TEXT.HUB_DICTATION_LISTENING);
      setMicLevel(0);
      publish({
        phase: 'recording',
        interim: '',
        transcript: mode === 'fresh' ? '' : transcriptRef.current,
        error: null,
        level: 0,
      });
      recorder.setLiveProfile(false);
      recorder.setCaptureEnabled(true);
      try {
        await recorder.startRecording();
      } catch {
        if (generation === generationRef.current) {
          showError(TEXT.HUB_DICTATION_FAILED);
        }
      }
    },
    [clearHideTimer, publish, setDockText, setPhase, showError]
  );

  const start = useCallback(async (): Promise<void> => {
    await openMic('fresh');
  }, [openMic]);

  const resume = useCallback(async (): Promise<void> => {
    await openMic('resume');
  }, [openMic]);

  /**
   * Stop the mic and return the session's text. The shared Stop button, Home
   * and Send all go through here, so they cannot disagree about the transcript.
   */
  const stopAndCollect = useCallback(async (): Promise<string | null> => {
    let transcript = (transcriptRef.current || interimRef.current).trim();
    if (stateRef.current !== 'recording') {
      return transcript || null;
    }
    const generation = generationRef.current;
    const recorder = getRecorder();
    manualStopRef.current = true;
    setPhase('transcribing');
    setDockText(TEXT.VOICE_TRANSCRIBING);
    setMicLevel(0);
    publish({ phase: 'transcribing', level: 0 });
    try {
      const stopped = await recorder?.stopRecording();
      if (generation !== generationRef.current) {
        return null;
      }
      transcript = mergeTranscript(interimRef.current, stopped ?? transcript);
    } catch {
      if (generation === generationRef.current) {
        showError(TEXT.HUB_DICTATION_FAILED);
      }
      return null;
    } finally {
      manualStopRef.current = false;
    }
    return transcript || null;
  }, [publish, setDockText, setPhase, showError]);

  const commit = useCallback(async (): Promise<void> => {
    if (stateRef.current !== 'recording') {
      return;
    }
    const transcript = await stopAndCollect();
    if (!transcript) {
      return;
    }
    transcriptRef.current = transcript;
    setLastTranscript(transcript);
    setPhase('ready');
    setDockText(transcript);
    publish({ phase: 'ready', interim: '', transcript, error: null, level: 0 });
  }, [publish, setDockText, setPhase, stopAndCollect]);

  const send = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    if (current !== 'recording' && current !== 'ready') {
      return;
    }
    const generation = generationRef.current;
    const transcript = await stopAndCollect();
    if (generation !== generationRef.current) {
      return;
    }
    if (!transcript) {
      if (stateRef.current !== 'error') {
        showError(TEXT.HUB_DICTATION_EMPTY);
      }
      return;
    }
    const api = window.electronAPI;
    if (!api?.startTurn || !api.getAllConversations || !api.createConversation) {
      showError(TEXT.HUB_DICTATION_FAILED);
      return;
    }
    transcriptRef.current = transcript;
    setLastTranscript(transcript);
    setPhase('thinking');
    setDockText(TEXT.HUB_DICTATION_THINKING);
    publish({ phase: 'sending', interim: '', transcript, error: null, level: 0 });
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
      setLastConversationId(conversation.id);
      // Peek first: the draft is consumed only once the turn actually starts,
      // otherwise a refused turn (busy, cross-conversation) throws the capture
      // away with no way back.
      const draft = api.getHudDraftImage ? await api.getHudDraftImage() : null;
      const result = await api.startTurn({
        conversationId: conversation.id,
        content: transcript,
        ...(draft
          ? {
              attachments: [
                { type: 'screen-capture' as const, data: draft.dataUrl, capture: draft.meta },
              ],
            }
          : {}),
      });
      if (draft && api.takeHudDraft) {
        await api.takeHudDraft();
      }
      if (generation !== generationRef.current) {
        return;
      }
      if (!tempRef.current) {
        tempRef.current = result.tempMessageId;
      }
      if (result.queued) {
        setDockText(TEXT.HUB_DICTATION_QUEUED);
      }
      // The turn owns the words now; the dictation session is over.
      endSession();
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
  }, [endSession, publish, setDockText, setPhase, showError, stopAndCollect]);

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
      endSession();
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
    endSession();
  }, [clearHideTimer, endSession, setDockText, setPhase]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const subscribe = window.electronAPI?.onDictationStopRequest;
    if (!subscribe) {
      return undefined;
    }
    // Another window (the launcher's mic button) asked the owner to stop.
    return subscribe(() => {
      void commitRef.current();
    });
  }, []);

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
    state === 'recording' ||
    state === 'ready' ||
    state === 'transcribing' ||
    recorderState === RecordingState.RECORDING;
  return {
    state,
    active,
    text,
    micLevel,
    conversationId: lastConversationId,
    transcript: lastTranscript,
    handOffText: state === 'ready' ? lastTranscript.trim() : '',
    start,
    resume,
    send,
    commit,
    cancel,
  };
}
