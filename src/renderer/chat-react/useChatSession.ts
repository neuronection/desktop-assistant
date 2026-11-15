import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BranchTree, ChatMessageView, buildBranchTree, useChatStream } from '@neuronection/assistant-ui/chat-core';
import { AppConfig } from '@shared/config/AppConfig';
import { Message, MessageRole, Attachment, RecordingState } from '@shared/types';
import type { CaptureOutcome } from '@shared/capture';
import type { CaptureTextState } from './CaptureTextPanel';
import { replaceEditedAttachment } from '@shared/viewer';
import type { ApprovalResolution, TurnStartRequest } from '@shared/turns';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { type LiveNoticeCode, type LiveSnapshot } from '@shared/live';
import type { CommandEntry } from '@shared/commands';
import { resolveSnippet, snippetCursor } from '@shared/snippets';
import { TOOL_SLASH_ALIASES, missingRequiredArgs, parseCommandInput, parsePalettePrefix } from '@shared/commands';
import { NotificationService } from '@renderer/services/NotificationService';
import { beginDialog, endDialog } from './dialogGuard';
import { useConversationActions } from './useConversationActions';
import { ConversationManager } from '@renderer/managers/ConversationManager';
import { RecordingManager } from '@renderer/managers/RecordingManager';
import { DICTATION_IDLE, dictationActive, type DictationSnapshot } from '@shared/dictation';
import { createIpcTransport, type ChatIpcTransportHooks } from './ipcTransport';
import { useLatestRef } from './useLatestRef';
import { createTurnTraceStore } from './turnTraceStore';
import { cachedCommandCatalog, formatSlashEntry, invalidateCommandCatalog, loadCommandCatalog, resolveSlashInput, webSearchBrowserOverride } from './commandSource';
import { miniAppForEntry } from './miniApps';
import type { SlashResolution } from './commandSource';
import { attachmentDisplayName } from './MessageAttachments';
import type { VoiceState } from './VoiceIndicator';
import { speechTextFromMarkdown } from './speechText';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { TEXT, interpolate } from '@shared/constants/text';

export type SpeechState = 'idle' | 'loading' | 'speaking' | 'paused';

export interface UseChatSessionOptions {
  onSessionChanged?: () => void;
  /** Fired when the voice auto-send flow submits a turn (UI state hook). */
  onAutoSendSubmit?: () => void;
  /** Fired right before a real turn starts (not for builtin commands) — UI state hook. */
  onTurnSubmitting?: () => void;
  /** Fired when a mini-app command is invoked without arguments (plan 14 §9) — UI enters the mode. */
  onMiniAppRequest?: (entry: CommandEntry, openOptions?: { targetCode?: string | null }) => void;
  /** Mini-app context for context-sensitive builtins (/exit, /quit). */
  isMiniAppActive?: () => boolean;
  onMiniAppExit?: () => void;
  /** When a mini app is active: which command ids remain executable (plan 14 §9 focus). */
  miniContext?: () => { active: boolean; allowedIds: string[]; appName: string } | null;
}

export function useChatSession(options: UseChatSessionOptions = {}) {
  const { onSessionChanged } = options;
  const onAutoSendSubmitRef = useRef(options.onAutoSendSubmit);
  onAutoSendSubmitRef.current = options.onAutoSendSubmit;
  const onTurnSubmittingRef = useRef(options.onTurnSubmitting);
  onTurnSubmittingRef.current = options.onTurnSubmitting;
  const onMiniAppRequestRef = useRef(options.onMiniAppRequest);
  onMiniAppRequestRef.current = options.onMiniAppRequest;
  const isMiniAppActiveRef = useRef(options.isMiniAppActive);
  isMiniAppActiveRef.current = options.isMiniAppActive;
  const onMiniAppExitRef = useRef(options.onMiniAppExit);
  onMiniAppExitRef.current = options.onMiniAppExit;
  const miniContextRef = useRef(options.miniContext);
  miniContextRef.current = options.miniContext;

  /** §9 focus: inside a mini app only its own command + exit stay executable. */
  const miniGuard = useCallback(
    (resolved: SlashResolution): boolean => {
      const context = miniContextRef.current?.();
      if (!context?.active) {
        return false;
      }
      const id =
        resolved.type === 'builtin' || resolved.type === 'custom'
          ? resolved.entry.id
          : resolved.type === 'tool'
            ? resolved.direct.commandId
            : null;
      return id !== null && !context.allowedIds.includes(id);
    },
    []
  );
  const managerRef = useRef<ConversationManager | null>(null);
  const manager = managerRef.current ?? (ConversationManager.getInstance());
  managerRef.current = manager;

  const [conversations, setConversations] = useState<{ id: string; title: string; updatedAt?: string }[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [branchTree, setBranchTree] = useState<BranchTree | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [captureText, setCaptureText] = useState<CaptureTextState | null>(null);
  const [captureTextBusy, setCaptureTextBusy] = useState(false);
  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceInterim, setVoiceInterim] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [selectionSupported, setSelectionSupported] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const viewerTargetRef = useRef<{ token: string; index: number; data: string } | null>(null);
  const interimRef = useRef('');
  const voiceStateRef = useRef<VoiceState>('idle');
  /** The one dictation session (plan 83): shared with the HUD by main. */
  const dictationRef = useRef<DictationSnapshot>({ ...DICTATION_IDLE });
  const selfStopRef = useRef(false);
  const applyTranscriptRef = useRef<(text: string) => void>(() => undefined);
  const finishRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const maybeAutoSendRef = useRef<((text: string) => Promise<void>) | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSnapshot | null>(null);
  const liveActiveRef = useRef(false);
  const liveStateRef = useRef<LiveSnapshot['state']>('idle');
  const liveShowIgnoredRef = useRef(false);
  const [liveIgnoredHint, setLiveIgnoredHint] = useState<string | null>(null);
  const [sentTranscript, setSentTranscript] = useState<string | null>(null);
  const sentTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const traceStoreRef = useRef(createTurnTraceStore());
  const trace = useSyncExternalStore(traceStoreRef.current.subscribe, traceStoreRef.current.getSnapshot);

  const refreshMessages = useCallback(async () => {
    const active = manager.getActiveMessages();
    setMessages(active.map((m: Message) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: 'done' as const,
      attachments: m.attachments?.length
        ? m.attachments.map((a, i) => ({
            id: `${m.id}-${i}`,
            name: attachmentDisplayName(a),
            kind: a.type === 'pdf' ? ('file' as const) : ('image' as const),
            url: a.data,
          }))
        : undefined,
      meta: m.metadata as unknown as Record<string, unknown> | undefined,
      parentId: m.parentId ?? null,
      ...(m.variantCount !== undefined && m.siblingIds
        ? {
            variants: {
              index: (m.variantIndex ?? 0) + 1,
              count: m.variantCount,
              siblingIds: m.siblingIds,
            },
          }
        : {}),
    })));
  }, [manager]);

  const refreshBranchTree = useCallback(async (): Promise<void> => {
    const active = manager.getActiveConversation();
    if (!active || active.id.startsWith('temp-') || !window.electronAPI.getConversationTree) {
      setBranchTree(null);
      return;
    }
    const tree = await window.electronAPI.getConversationTree(active.id);
    setBranchTree(
      buildBranchTree({
        activeRootId: tree.activeRootId,
        nodes: tree.nodes.map((message) => ({
          id: message.id,
          role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system',
          excerpt: message.content.slice(0, 100),
          parentId: message.parentId ?? null,
          activeChildId: message.activeChildId ?? null,
        })),
      })
    );
  }, [manager]);

  const refreshConversations = useCallback(async () => {
    const all = await manager.getAllConversations();
    setConversations(all.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
    })));
    const active = manager.getActiveConversation();
    setActiveId(active?.id ?? null);
  }, [manager]);

  useEffect(() => {
    (async () => {
      const loaded: AppConfig = await window.electronAPI.loadConfig();
      setConfig(loaded);
      await manager.loadOrCreateConversation();
      await Promise.all([refreshConversations(), refreshMessages(), refreshBranchTree()]);
    })();
  }, [manager, refreshConversations, refreshMessages, refreshBranchTree]);

  useEffect(() => {
    const terminalRunEvents = new Set(['run:finished', 'run:failed', 'run:canceled']);
    const unsubscribe = window.electronAPI.onMiniAppRunEvent?.((event) => {
      if (!terminalRunEvents.has(event.type)) {
        return;
      }
      const active = manager.getActiveConversation();
      if (active && !active.id.startsWith('temp-')) {
        void manager.loadAndSetActiveConversation(active.id).then(() => refreshMessages());
      }
    });
    return () => unsubscribe?.();
  }, [manager, refreshMessages]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onConfigUpdate) {
      return undefined;
    }
    return window.electronAPI.onConfigUpdate((newConfig) => {
      setConfig((prev) => (prev ? { ...prev, ...newConfig } : prev));
      invalidateCommandCatalog();
    });
  }, []);

  useEffect(() => {
    liveShowIgnoredRef.current = config?.voice?.liveShowIgnored === true;
  }, [config]);

  useEffect(() => {
    void loadCommandCatalog().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.selectionSupported) {
      return undefined;
    }
    void window.electronAPI
      .selectionSupported()
      .then(setSelectionSupported)
      .catch(() => setSelectionSupported(false));
    return undefined;
  }, []);

  useEffect(() => {
    let recorder: RecordingManager;
    try {
      recorder = RecordingManager.getInstance();
    } catch {
      return undefined;
    }
    let levelFrame = 0;
    let pendingLevel = 0;
    let lastLevelAt = 0;
    const report = (patch: Partial<DictationSnapshot>): void => {
      void window.electronAPI?.reportDictation?.(patch).catch(() => undefined);
    };
    const onVoiceState = (state: RecordingState): void => {
      const wasRecording = voiceStateRef.current === 'recording';
      const pendingText = interimRef.current.trim();
      const mapped = state === RecordingState.RECORDING ? 'recording' : state === RecordingState.PROCESSING ? 'transcribing' : 'idle';
      setVoiceState(mapped);
      voiceStateRef.current = mapped;
      if (state !== RecordingState.RECORDING) {
        setVoiceLevel(0);
        setVoiceInterim('');
        interimRef.current = '';
      }
      if (state === RecordingState.PROCESSING) {
        report({ phase: 'transcribing', level: 0 });
      }
      if (state === RecordingState.IDLE) {
        // The recorder ends a dictation on a real pause. The phrases are
        // already in the interim text, so they must land in the composer
        // instead of being cleared with the state.
        if (wasRecording && !selfStopRef.current && pendingText) {
          applyTranscriptRef.current(pendingText);
        }
        if (wasRecording) {
          report({ phase: 'idle' });
        }
      }
    };
    const onInterim = (text: string): void => {
      setVoiceInterim(text);
      interimRef.current = text;
      report({ phase: 'recording', interim: text });
      if (liveStateRef.current === 'listening') {
        setSentTranscript(null);
      }
      if (!liveActiveRef.current) {
        void maybeAutoSendRef.current?.(text);
      }
    };
    const onSegment = (text: string): void => {
      if (!liveActiveRef.current) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      // Live facts (phrase committed / barge-in) come from the hidden live
      // host (plan 61); this recorder only drives push-to-talk.
    };
    const onVolume = (volume: number): void => {
      pendingLevel = volume;
      const now = Date.now();
      if (now - lastLevelAt >= 120) {
        lastLevelAt = now;
        report({ level: volume });
      }
      if (!levelFrame) {
        levelFrame = requestAnimationFrame(() => {
          levelFrame = 0;
          setVoiceLevel(pendingLevel);
        });
      }
    };
    const onVoiceError = (error: Error): void => {
      NotificationService.showError(interpolate(TEXT.SESSION_VOICE_FAILED, { error: error.message }));
    };
    const onTranscriptError = (error: Error): void => {
      onVoiceError(error);
    };
    recorder.on('state:change', onVoiceState);
    recorder.on('volume:change', onVolume);
    recorder.on('interim:transcript', onInterim);
    recorder.on('transcript:received', onSegment);
    recorder.on('recording:error', onVoiceError);
    recorder.on('transcript:error', onTranscriptError);
    return () => {
      recorder.off('state:change', onVoiceState);
      recorder.off('volume:change', onVolume);
      recorder.off('interim:transcript', onInterim);
      recorder.off('transcript:received', onSegment);
      recorder.off('recording:error', onVoiceError);
      recorder.off('transcript:error', onTranscriptError);
      if (levelFrame) {
        cancelAnimationFrame(levelFrame);
      }
    };
  }, []);

  const pendingDirectRef = useRef<TurnStartRequest['directTool'] | null>(null);
  const pendingFlowRef = useRef<TurnStartRequest['flow'] | null>(null);

  const buildTurnRequest = useCallback((text: string): TurnStartRequest | null => {
    const active = manager.getActiveConversation();
    if (!active) {
      return null;
    }
    const direct = pendingDirectRef.current ?? undefined;
    pendingDirectRef.current = null;
    const flow = pendingFlowRef.current ?? undefined;
    pendingFlowRef.current = null;

    return {
      conversationId: active.id,
      content: text,
      attachments,
      modelId: active.metadata?.modelId ?? '',
      ...(direct ? { directTool: direct } : {}),
      ...(flow ? { flow } : {}),
    };
  }, [attachments, manager]);


  const turnSourceIdRef = useRef<string | null>(null);
  const pendingLocalIdRef = useRef<string | null>(null);

  /**
   * Persist metadata set while a conversation was still temp (plan 24 S5
   * follow-up): the first turn creates the DB row, so the in-memory
   * override is written through once the conversation is real.
   */
  const applyConversationMetadata = useCallback(
    async (patch: { speakMode?: 'on' | 'off' }): Promise<void> => {
      const active = manager.getActiveConversation();
      if (!active) {
        return;
      }
      const metadata = { ...active.metadata };
      if (patch.speakMode === 'on') {
        metadata.speakReplies = true;
      } else if (patch.speakMode === 'off') {
        delete metadata.speakReplies;
      }
      active.metadata = metadata;
      if (!active.id.startsWith('temp-')) {
        await window.electronAPI.setConversationMetadata(active.id, metadata);
      }
      await refreshConversations();
    },
    [manager, refreshConversations]
  );

  const handleTurnFinished = useCallback(
    async (conversationId: string, speakMode?: 'on' | 'off') => {
      if (turnSourceIdRef.current === null || manager.getActiveConversation()?.id === turnSourceIdRef.current) {
        // Carry metadata set while temp across the reload.
        const carried = manager.getActiveConversation()?.metadata;
        await manager.loadAndSetActiveConversation(conversationId);
        if (carried) {
          const loaded = manager.getActiveConversation();
          if (loaded) {
            loaded.metadata = { ...carried, ...loaded.metadata };
          }
        }
        await Promise.all([refreshMessages(), refreshBranchTree()]);
      }
      if (speakMode) {
        await applyConversationMetadata({ speakMode });
      } else {
        const active = manager.getActiveConversation();
        if (active && !active.id.startsWith('temp-') && active.metadata) {
          await window.electronAPI.setConversationMetadata(active.id, active.metadata);
        }
      }
      await refreshConversations();
      turnSourceIdRef.current = null;
    },
    [manager, refreshConversations, refreshMessages, refreshBranchTree, applyConversationMetadata]
  );

  const [speechState, setSpeechState] = useState<SpeechState>('idle');
  const [busSpeech, setBusSpeech] = useState<SpeechSnapshot>(SPEECH_INITIAL);
  /** In-flight synthesis request ids on the audioOps cancel seam. */
  const speechRequestsRef = useRef<Set<string>>(new Set());
  /** Bumped on stop: a synth resolving after cancel is discarded, never played. */
  const speakGenRef = useRef(0);

  const stopSpeaking = useCallback((): void => {
    speakGenRef.current += 1;
    for (const id of speechRequestsRef.current) {
      void window.electronAPI.cancelAudioOp(id).catch(() => undefined);
    }
    speechRequestsRef.current.clear();
    setSpeechState('idle');
    if (!liveActiveRef.current) {
      void window.electronAPI.controlSpeech?.('stop');
    }
  }, []);

  /**
   * Reply speech goes through the ONE main-owned bus (plan 58 S6a): main
   * sequences chunks, cache and playback, so a reply no longer plays in
   * this renderer at all (the live loop keeps its own queue).
   */
  const speakText = useCallback(async (text: string, dedupeKey?: string): Promise<void> => {
    const clean = text.trim();
    if (!clean) {
      return;
    }
    try {
      await window.electronAPI.speakText({
        text: clean,
        source: 'reply',
        ...(dedupeKey ? { dedupeKey } : {}),
      });
    } catch (error) {
      console.error('speech request failed:', error);
    }
  }, []);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api?.onSpeechState) {
      return undefined;
    }
    let mounted = true;
    let received = false;
    const off = api.onSpeechState((next) => {
      received = true;
      setBusSpeech(next);
    });
    void api
      .getSpeechSnapshot?.()
      .then((initial) => {
        if (mounted && !received && initial) {
          setBusSpeech(initial);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const speakReply = useCallback(
    async (markdown: string, spokenRequested = false, messageId?: string): Promise<void> => {
      const conversationSpeak = manager.getActiveConversation()?.metadata?.speakReplies;
      if (!config?.voice?.speakReplies && conversationSpeak !== true && !spokenRequested) {
        return;
      }
      await speakText(speechTextFromMarkdown(markdown), messageId);
    },
    [config?.voice?.speakReplies, speakText, manager]
  );

  const transportHooks = useLatestRef<ChatIpcTransportHooks>({
    onStartTurn: (text) => {
      const request = buildTurnRequest(text);
      if (!request) {
        return null;
      }
      turnSourceIdRef.current = request.conversationId;
      pendingLocalIdRef.current = manager.appendLocalMessage(text, MessageRole.USER, attachments).id;
      setAttachments([]);
      void refreshMessages();
      return request;
    },
    onFinishTurn: async (outcome) => {
      if (outcome.phase === 'failed') {
        NotificationService.showError(interpolate(TEXT.SESSION_TURN_ERROR, { error: outcome.error }));
      }
      pendingLocalIdRef.current = null;
      await handleTurnFinished(outcome.conversationId, outcome.phase === 'finished' ? outcome.speakMode : undefined);
      if (outcome.phase === 'finished') {
        const lastAssistant = manager
          .getActiveMessages()
          .filter((message) => message.role === MessageRole.ASSISTANT && !message.error)
          .at(-1);
        if (liveActiveRef.current) {
          // The hidden live host synthesizes and plays the reply (plan 61);
          // main forwards the finished turn text.
        } else if (outcome.speakText) {
          void speakText(outcome.speakText, lastAssistant?.id);
        } else if (lastAssistant?.content) {
          void speakReply(lastAssistant.content, outcome.speak === true, lastAssistant.id);
        }
      }
    },
    onTurnRejected: () => {
      if (pendingLocalIdRef.current) {
        manager.removeLocalMessage(pendingLocalIdRef.current);
        pendingLocalIdRef.current = null;
      }
      turnSourceIdRef.current = null;
      void refreshMessages();
    },
    onTurnQueued: () => NotificationService.showInfo(TEXT.TURN_QUEUED),
    onLimitNotice: (kind) => {
      const message =
        kind === 'step-budget'
          ? TEXT.NOTICE_TURN_LIMIT_STEP
          : kind === 'token-budget'
            ? TEXT.NOTICE_TURN_LIMIT_TOKEN
            : TEXT.NOTICE_TURN_LIMIT_TIME;
      NotificationService.showInfo(message);
    },
    onTurnEvent: (event) => traceStoreRef.current.handleEvent(event),
  });

  // The transport is a STABLE singleton: its hooks read the latest ref, so
  // the turn-event subscription is bound once and never churns with render
  // deps (the delta-loss class — plan 42 FIX 6).
  const transport = useMemo(
    () =>
      createIpcTransport({
        onStartTurn: (text) => transportHooks.current.onStartTurn(text),
        onFinishTurn: (outcome) => transportHooks.current.onFinishTurn(outcome),
        onTurnRejected: () => transportHooks.current.onTurnRejected?.(),
        onTurnQueued: () => transportHooks.current.onTurnQueued?.(),
        onLimitNotice: (kind) => transportHooks.current.onLimitNotice?.(kind),
        onTurnEvent: (event) => transportHooks.current.onTurnEvent?.(event),
      }),
    [transportHooks]
  );

  const live = useChatStream({
    transport,
    flushMs: 33,
    timeoutMs: 120000,
  });

  /** Turn-start funnel: clears the trace snapshot BEFORE the launcher flips
   * to thinking — the store only reseeds when main broadcasts `queued`, and
   * without this the strip renders the previous turn's steps (which may
   * belong to a previously selected session) during the submit roundtrip. */
  const beginTurn = useCallback((): void => {
    traceStoreRef.current.reset();
    onTurnSubmittingRef.current?.();
  }, []);

  /** Starts a named-flow turn (the prompt is the flow input, e.g. the research topic). */
  const sendFlowTurn = useCallback(
    async (prompt: string, flow: TurnStartRequest['flow']) => {
      if (flow) {
        pendingFlowRef.current = flow;
      }
      beginTurn();
      await live.send(prompt);
      setInput('');
    },
    [beginTurn, live]
  );

  const selectConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      await manager.loadAndSetActiveConversation(conversationId);
      setActiveId(conversationId);
      onSessionChanged?.();
      await refreshConversations();
      await refreshMessages();
      await refreshBranchTree();
    },
    [manager, onSessionChanged, refreshConversations, refreshMessages, refreshBranchTree]
  );

  const runBuiltinCommand = useCallback(
    async (entryId: string, argv: string[]): Promise<void> => {
      const opensPicker = entryId.startsWith('miniapp:run:');
      if (opensPicker) {
        beginDialog();
      }
      try {
        const outcome = await window.electronAPI.executeCommand(entryId, argv, 'palette');
        if (outcome.status === 'error') {
          if (outcome.error !== 'cancelled') {
            NotificationService.showError(outcome.error);
          }
          return;
        }
        if (outcome.status === 'turn' && outcome.prompt) {
          await sendFlowTurn(outcome.prompt, outcome.flow);
          return;
        }
        if (outcome.status === 'done' && outcome.conversationId) {
          await selectConversation(outcome.conversationId);
          await window.electronAPI.openDesktop(outcome.conversationId);
          if (outcome.text) {
            NotificationService.showSuccess(outcome.text);
          }
          return;
        }
        if (outcome.status === 'done' && outcome.text) {
          await window.electronAPI.writeToClipboard(outcome.text).catch(() => undefined);
          NotificationService.showSuccess(`${outcome.text} — ${TEXT.COMMAND_COPY_DONE}`);
        }
      } finally {
        if (opensPicker) {
          endDialog();
        }
      }
    },
    [sendFlowTurn, selectConversation]
  );

  const newConversation = useCallback(async () => {
    const conv = manager.createNewConversation();
    setActiveId(conv.id);
    onSessionChanged?.();
    await refreshConversations();
    await refreshMessages();
    await refreshBranchTree();
  }, [manager, onSessionChanged, refreshConversations, refreshMessages, refreshBranchTree]);


  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() && attachments.length === 0) {
        return;
      }
      const leading = text.trimStart();
      if (!leading.startsWith('/') && parsePalettePrefix(leading).kind !== 'none') {
        return;
      }
      if (live.live?.status === 'pending' || live.live?.status === 'streaming') {
        const queuedRequest = buildTurnRequest(text);
        if (!queuedRequest) {
          NotificationService.showError(TEXT.COMMAND_TURN_IN_PROGRESS);
          return;
        }
        try {
          const started = await window.electronAPI.startTurn(queuedRequest);
          if (started?.queued) {
            NotificationService.showInfo(TEXT.TURN_QUEUED);
          }
          setInput('');
        } catch (error) {
          NotificationService.showError(interpolate(TEXT.SESSION_TURN_ERROR, { error: (error as Error).message }));
        }
        return;
      }
      if (text.trimStart().startsWith('/')) {
        // A pending invalidation (config save) or first use may leave the
        // cache cold — never degrade typed slash input into a chat message.
        if (!cachedCommandCatalog()) {
          await loadCommandCatalog().catch(() => undefined);
        }
        const resolved = resolveSlashInput(
          text,
          config?.commands?.argDefaults,
          config?.translation?.customLanguages?.map((entry) => entry.code) ?? []
        );
        if (resolved.type === 'unknown') {
          NotificationService.showError(interpolate(TEXT.COMMAND_UNKNOWN, { command: resolved.command }));
          return;
        }
        if (resolved.type === 'usage') {
          NotificationService.showError(resolved.usage);
          return;
        }
        // A tool alias typed before the catalog loaded must not be sent as
        // prose (the model would try to «run» it and surface argument errors).
        // The alias map is static, so we can recognize it without the catalog:
        // warm the catalog and keep the text — the palette then shows the
        // command with its help and argument guard.
        if (resolved.type === 'none' && text.trimStart().startsWith('/')) {
          const alias = parseCommandInput(text).alias;
          const knownToolAlias =
            alias !== null && Object.values(TOOL_SLASH_ALIASES).some((aliases) => aliases.includes(alias));
          if (knownToolAlias) {
            void loadCommandCatalog(true).catch(() => undefined);
            return;
          }
        }
        if (miniGuard(resolved)) {
          NotificationService.showError(
            interpolate(TEXT.COMMAND_MINI_BLOCKED, { command: text.trimStart().slice(1).split(/\s/)[0], app: miniContextRef.current?.()?.appName ?? 'the mini app' })
          );
          return;
        }
        if (resolved.type === 'builtin') {
          if (miniAppForEntry(resolved.entry) && resolved.argv.length === 0) {
            setInput('');
            onMiniAppRequestRef.current?.(resolved.entry);
            return;
          }
          if (resolved.entry.action === 'nav:quit' && isMiniAppActiveRef.current?.()) {
            setInput('');
            onMiniAppExitRef.current?.();
            return;
          }
          if (resolved.entry.action === 'snippet:insert' && (await insertSnippet(resolved.entry))) {
            return;
          }
          if (resolved.entry.action === 'nav:new-conversation') {
            setInput('');
            await newConversation();
            return;
          }
          if (await runConversationAction(resolved.entry)) {
            return;
          }
          setInput('');
          await runBuiltinCommand(resolved.entry.id, resolved.argv);
          return;
        }
        if (resolved.type === 'custom') {
          const outcome = await window.electronAPI.executeCommand(resolved.entry.id, resolved.argv, 'palette');
          if (outcome.status === 'error') {
            NotificationService.showError(outcome.error);
            return;
          }
          if (outcome.status === 'done') {
            setInput('');
            if (outcome.text) {
              NotificationService.showSuccess(outcome.text.slice(0, 200));
            }
            return;
          }
          if (outcome.prompt) {
            beginTurn();
            await live.send(outcome.prompt);
            setInput('');
            return;
          }
          if (outcome.direct) {
            pendingDirectRef.current = { ...outcome.direct, commandId: resolved.entry.id };
            beginTurn();
            await live.send(text);
            setInput('');
            return;
          }
          return;
        }
        if (resolved.type === 'tool') {
          if (resolved.direct.name === 'web_search') {
            const query = String(resolved.direct.args.query ?? '').trim();
            if (!query) {
              NotificationService.showError(TEXT.COMMAND_WEB_USAGE);
              return;
            }
            const url = webSearchBrowserOverride(query, {
              enabledProviders: enabledProviderCount(config),
              behavior: config?.commands?.web?.behavior ?? 'inline',
              fallbackEngine: config?.commands?.web?.fallbackEngine ?? 'https://duckduckgo.com/?q=',
            });
            if (url !== null) {
              setInput('');
              await window.electronAPI.openExternal(url);
              NotificationService.showSuccess(
                enabledProviderCount(config) > 0 ? TEXT.COMMAND_WEB_BROWSER_MODE : TEXT.COMMAND_WEB_BROWSER_FALLBACK
              );
              return;
            }
          }
          if (resolved.direct.name === 'translate' && !String(resolved.direct.args.text ?? '').trim()) {
            if (!onMiniAppRequestRef.current || !resolved.entry) {
              NotificationService.showError(TEXT.TRANSLATE_USAGE);
              return;
            }
            setInput('');
            onMiniAppRequestRef.current?.(resolved.entry, {
              targetCode: typeof resolved.direct.args.target === 'string' ? resolved.direct.args.target : null,
            });
            return;
          }
          const parsedArgv = parseCommandInput(text).argv;
          const rawRest = text.trimStart().replace(/^\/\S+\s*/, '').trim();
          if (
            resolved.entry &&
            missingRequiredArgs(resolved.entry, parsedArgv, config?.commands?.argDefaults?.[resolved.entry.id], rawRest).length > 0
          ) {
            setInput(`${formatSlashEntry(resolved.entry, [])} `);
            composerRef.current?.focus();
            return;
          }
          pendingDirectRef.current = resolved.direct;
        }
      }
      beginTurn();
      await live.send(text);
      setInput('');
    },
    [attachments.length, beginTurn, buildTurnRequest, config, live, runBuiltinCommand, newConversation]
  );

  /**
   * Executes a palette-selected entry (plan 14 S8 fix): non-tool kinds
   * go straight to `commands:execute` by entry id — never re-parsed
   * from formatted text, so fuzzy/partial matches work; tool-kind
   * entries keep the canonical-slash turn path.
   */
  const insertSnippet = useCallback(
    async (entry: CommandEntry): Promise<boolean> => {
      const snippet = config?.commands?.snippets?.find((candidate) => `snippet:${candidate.id}` === entry.id);
      if (!snippet) {
        return false;
      }
      let clipboardText = '';
      if (snippet.body.includes('{clipboard}')) {
        try {
          clipboardText = await window.electronAPI.readFromClipboard();
        } catch {
          NotificationService.showError(TEXT.SNIPPET_CLIPBOARD_UNAVAILABLE);
        }
      }
      const values = { date: new Date().toLocaleDateString(), clipboard: clipboardText };
      const body = resolveSnippet(snippet.body, values);
      const cursor = snippetCursor(snippet.body, values);
      setInput(body);
      window.dispatchEvent(new CustomEvent('da:snippet-inserted', { detail: body }));
      requestAnimationFrame(() => {
        const composer = composerRef.current;
        if (!composer) {
          return;
        }
        composer.focus();
        const at = cursor ?? body.length;
        composer.setSelectionRange(at, at);
      });
      return true;
    },
    [config, setInput]
  );

  const runCommandEntry = useCallback(
    async (entry: CommandEntry, argv: string[]): Promise<void> => {
      if (miniContextRef.current?.()?.active && !(miniContextRef.current?.()?.allowedIds ?? []).includes(entry.id)) {
        NotificationService.showError(
          interpolate(TEXT.COMMAND_MINI_BLOCKED, { command: entry.slash ?? entry.aliases[0] ?? entry.title, app: miniContextRef.current?.()?.appName ?? 'the mini app' })
        );
        return;
      }
      if (entry.action === 'snippet:insert' && (await insertSnippet(entry))) {
        return;
      }
      if (entry.kind === 'tool' && entry.toolName) {
        await submit(formatSlashEntry(entry, argv));
        return;
      }
      if (miniAppForEntry(entry) && argv.length === 0) {
        setInput('');
        onMiniAppRequestRef.current?.(entry);
        return;
      }
      if (entry.action === 'nav:quit' && isMiniAppActiveRef.current?.()) {
        setInput('');
        onMiniAppExitRef.current?.();
        return;
      }
      if (entry.action === 'nav:new-conversation') {
        setInput('');
        await newConversation();
        return;
      }
      if (await runConversationAction(entry)) {
        return;
      }
      const outcome = await window.electronAPI.executeCommand(entry.id, argv, 'palette');
      if (outcome.status === 'error') {
        NotificationService.showError(outcome.error);
        return;
      }
      if (outcome.status === 'turn' && outcome.prompt) {
        await sendFlowTurn(outcome.prompt, outcome.flow);
        return;
      }
      if (outcome.status === 'turn' && outcome.direct) {
        pendingDirectRef.current = { ...outcome.direct, commandId: entry.id };
        beginTurn();
        await live.send(formatSlashEntry(entry, argv) || entry.title);
        setInput('');
        return;
      }
      if (outcome.status !== 'done') {
        return;
      }
      setInput('');
      if (outcome.conversationId) {
        await selectConversation(outcome.conversationId);
        await window.electronAPI.openDesktop(outcome.conversationId);
      }
      if (outcome.text) {
        if (entry.action === 'calc:evaluate') {
          await window.electronAPI.writeToClipboard(outcome.text).catch(() => undefined);
          NotificationService.showSuccess(`${outcome.text} — ${TEXT.COMMAND_COPY_DONE}`);
        } else {
          NotificationService.showSuccess(outcome.text.slice(0, 200));
        }
      }
    },
    [beginTurn, sendFlowTurn, submit, newConversation, selectConversation, insertSnippet]
  );

  const maybeAutoSend = useCallback(
    async (text: string) => {
      if (!window.electronAPI.evaluateUtterance) {
        return;
      }
      const verdict = await window.electronAPI.evaluateUtterance(text, manager.getActiveConversation()?.id).catch(() => null);
      if (!verdict?.complete) {
        return;
      }
      if (interimRef.current !== text || voiceStateRef.current !== 'recording') {
        return;
      }
      // Queueing behind a live turn keeps its strip; a fresh turn clears
      // the stale snapshot BEFORE the launcher flips to thinking — the
      // stop-recording roundtrip must not show the previous turn's steps.
      // The status is read pre-roundtrip: a turn starting mid-window
      // re-seeds the strip on its next event, so the race self-heals.
      const queueingBehindLive = live.live?.status === 'pending' || live.live?.status === 'streaming';
      if (!queueingBehindLive) {
        traceStoreRef.current.reset();
      }
      onAutoSendSubmitRef.current?.();
      let finalText: string | null = null;
      selfStopRef.current = true;
      try {
        finalText = await RecordingManager.getInstance().stopRecording();
      } catch {
        return;
      } finally {
        selfStopRef.current = false;
        void window.electronAPI?.endDictation?.().catch(() => undefined);
      }
      const toSend = (verdict.text ?? finalText ?? text).trim();
      if (toSend) {
        await submit(toSend);
      }
    },
    [live, submit]
  );
  maybeAutoSendRef.current = maybeAutoSend;

  const applyTranscript = useCallback((transcript: string): void => {
    setInput((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
    composerRef.current?.focus();
  }, []);
  applyTranscriptRef.current = applyTranscript;

  const finishRecording = useCallback(async (): Promise<void> => {
    const recorder = RecordingManager.getInstance();
    selfStopRef.current = true;
    void window.electronAPI?.reportDictation?.({ phase: 'transcribing', level: 0 }).catch(() => undefined);
    let transcript: string | null = null;
    try {
      transcript = await recorder.stopRecording();
    } finally {
      selfStopRef.current = false;
      void window.electronAPI?.reportDictation?.({ phase: 'idle' }).catch(() => undefined);
    }
    if (!transcript) {
      return;
    }
    let final = transcript;
    try {
      const cfg = await window.electronAPI.loadConfig();
      if (cfg?.voice && (cfg.voice.autoFix || cfg.voice.formatting) && window.electronAPI.evaluateUtterance) {
        const verdict = await window.electronAPI.evaluateUtterance(final, manager.getActiveConversation()?.id).catch(() => null);
        if (verdict?.text) {
          final = verdict.text;
        }
      }
    } catch {
      applyTranscript(transcript);
      return;
    }
    applyTranscript(final);
  }, [manager, applyTranscript]);

  finishRecordingRef.current = finishRecording;

  const toggleRecording = useCallback(async () => {
    const recorder = RecordingManager.getInstance();
    const shared = dictationRef.current;
    // The session may belong to another window (the HUD): stopping it here is
    // the same command, routed back to whoever holds the mic.
    if (dictationActive(shared)) {
      if (shared.origin === 'launcher' || shared.origin === 'desktop') {
        await finishRecording();
      } else {
        // HUD (or another window) owns the mic: main forwards the stop.
        void window.electronAPI?.stopDictation?.().catch(() => false);
      }
      return;
    }
    if (recorder.isRecording()) {
      await finishRecording();
      return;
    }
    if (!recorder.isProcessing()) {
      const begun = await window.electronAPI?.beginDictation?.('launcher').catch(() => null);
      if (begun && begun.ok === false) {
        return;
      }
      try {
        await recorder.startRecording();
      } catch {
        void window.electronAPI?.endDictation?.().catch(() => undefined);
      }
    }
  }, [finishRecording]);

  const startPushToTalk = useCallback(async (): Promise<boolean> => {
    let recorder: RecordingManager;
    try {
      recorder = RecordingManager.getInstance();
    } catch {
      return false;
    }
    if (dictationActive(dictationRef.current) || recorder.isRecording() || recorder.isProcessing()) {
      return false;
    }
    const begun = await window.electronAPI?.beginDictation?.('hotkey').catch(() => null);
    if (begun && begun.ok === false) {
      return false;
    }
    try {
      await recorder.startRecording();
      return true;
    } catch {
      void window.electronAPI?.endDictation?.().catch(() => undefined);
      return false;
    }
  }, []);

  const stopPushToTalk = useCallback(async (): Promise<void> => {
    let recorder: RecordingManager;
    try {
      recorder = RecordingManager.getInstance();
    } catch {
      return;
    }
    if (!recorder.isRecording()) {
      return;
    }
    await finishRecording();
  }, [finishRecording]);

  const cancelRecording = useCallback((): void => {
    const shared = dictationRef.current;
    if (dictationActive(shared) && shared.origin !== 'launcher' && shared.origin !== 'desktop') {
      // Another surface owns the words: the shared verb is "stop", never a
      // silent discard of someone else's dictation.
      void window.electronAPI?.stopDictation?.().catch(() => false);
      return;
    }
    try {
      RecordingManager.getInstance().cancelRecording();
    } catch {
      return;
    } finally {
      void window.electronAPI?.endDictation?.().catch(() => undefined);
    }
  }, []);

  const clearInterim = useCallback((): void => {
    try {
      RecordingManager.getInstance().clearInterim();
    } catch {
      return;
    }
    setVoiceInterim('');
    interimRef.current = '';
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLiveEvent) {
      return undefined;
    }
    let ignoredTimer: ReturnType<typeof setTimeout> | null = null;
    void api
      .getLiveState()
      .then((snapshot) => {
        setLiveSnapshot(snapshot);
        liveStateRef.current = snapshot.state;
        liveActiveRef.current = snapshot.state !== 'idle' && snapshot.state !== 'error';
      })
      .catch(() => undefined);
    const unsubscribe = api.onLiveEvent((event) => {
      if (event.type === 'state') {
        const previous = liveStateRef.current;
        const active = event.snapshot.state !== 'idle' && event.snapshot.state !== 'error';
        setLiveSnapshot(event.snapshot);
        liveStateRef.current = event.snapshot.state;
        liveActiveRef.current = active;
        if (event.snapshot.state === 'listening' && previous === 'speaking') {
          clearInterim();
        }
      } else if (event.type === 'transcript') {
        clearInterim();
        setSentTranscript(event.text);
        if (sentTranscriptTimerRef.current) {
          clearTimeout(sentTranscriptTimerRef.current);
        }
        sentTranscriptTimerRef.current = setTimeout(() => setSentTranscript(null), 3000);
      } else if (event.type === 'intent') {
        if (event.intent === 'ignore' && event.text && liveShowIgnoredRef.current) {
          setLiveIgnoredHint(event.text);
          if (ignoredTimer) {
            clearTimeout(ignoredTimer);
          }
          ignoredTimer = setTimeout(() => setLiveIgnoredHint(null), 2500);
        }
      } else if (event.type === 'notice') {
        const message = liveNoticeText(event.code);
        if (message) {
          if (event.level === 'error') {
            NotificationService.showError(message);
          } else {
            NotificationService.showInfo(message);
          }
        }
      } else if (event.type === 'ended') {
        liveActiveRef.current = false;
        liveStateRef.current = 'idle';
        setLiveIgnoredHint(null);
        setSentTranscript(null);
        if (sentTranscriptTimerRef.current) {
          clearTimeout(sentTranscriptTimerRef.current);
          sentTranscriptTimerRef.current = null;
        }
      }
    });
    return () => {
      unsubscribe();
      if (ignoredTimer) {
        clearTimeout(ignoredTimer);
      }
      if (sentTranscriptTimerRef.current) {
        clearTimeout(sentTranscriptTimerRef.current);
      }
    };
  }, [clearInterim]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onStopSpeaking) {
      return undefined;
    }
    return api.onStopSpeaking(() => {
      stopSpeaking();
    });
  }, [stopSpeaking]);

  const startLive = useCallback(async (): Promise<void> => {
    const active = manager.getActiveConversation() ?? manager.createNewConversation();
    await window.electronAPI.startLive(active.id);
  }, [manager]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onStartLive) {
      return undefined;
    }
    return api.onStartLive(() => {
      if (!liveActiveRef.current) {
        void startLive();
      }
    });
  }, [startLive]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onStartDictation) {
      return undefined;
    }
    return api.onStartDictation(() => {
      void startPushToTalk();
    });
  }, [startPushToTalk]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLauncherOpenWithText) {
      return undefined;
    }
    return api.onLauncherOpenWithText((text) => {
      setInput(text);
      requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.select();
      });
    });
  }, []);

  const stopLive = useCallback((): void => {
    liveActiveRef.current = false;
    liveStateRef.current = 'idle';
    void window.electronAPI.stopLive();
  }, []);

  const interruptLive = useCallback((): void => {
    window.electronAPI.liveInterrupt();
  }, []);

  const setLiveFullDuplex = useCallback((fullDuplex: boolean): void => {
    window.electronAPI.liveSetFullDuplex(fullDuplex);
  }, []);

  const handleFiles = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await fileToDataUrl(file);
        setAttachments((prev) => [...prev, { type: 'image', data: dataUrl }]);
      } else if (file.type === 'application/pdf') {
        const dataUrl = await fileToDataUrl(file);
        const response = await window.electronAPI.processPdfAttachment(dataUrl);
        if (response.success) {
          setAttachments((prev) => [
            ...prev,
            { type: 'pdf', data: dataUrl, filename: file.name, extractedText: response.data.extractedText ?? undefined },
          ]);
        } else {
          NotificationService.showError(interpolate(TEXT.SESSION_PDF_FAILED, { error: response.error }));
        }
      }
    }
  }, []);

  const appendCapture = useCallback((outcome: CaptureOutcome): void => {
    if (!outcome.ok) {
      if (outcome.reason !== 'cancelled') {
        NotificationService.showError(
          interpolate(TEXT.CAPTURE_FAILED, { error: outcome.message ?? TEXT.CAPTURE_UNAVAILABLE })
        );
      }
      return;
    }
    setAttachments((prev) => [
      ...prev,
      { type: 'screen-capture', data: outcome.dataUrl, capture: outcome.meta },
    ]);
  }, []);

  /** Open a draft attachment in the image viewer (zoom, and crop/redact). */
  const openAttachment = useCallback(
    async (index: number): Promise<void> => {
      const attachment = attachments[index];
      if (!attachment || attachment.type === 'pdf') {
        return;
      }
      const title =
        attachment.type === 'screen-capture' && attachment.capture?.label
          ? attachment.capture.label
          : TEXT.ATTACHMENT_IMAGE;
      const opened = await window.electronAPI.openImageViewer({
        dataUrl: attachment.data,
        title,
        editable: true,
      });
      if (opened.ok && opened.token) {
        viewerTargetRef.current = { token: opened.token, index, data: attachment.data };
      }
    },
    [attachments]
  );

  /** Chip quick action: copy the attachment's image, without opening the viewer. */
  const copyAttachmentImage = useCallback(
    async (index: number): Promise<void> => {
      const attachment = attachments[index];
      if (!attachment || attachment.type === 'pdf') {
        return;
      }
      await window.electronAPI.copyImage(attachment.data);
    },
    [attachments]
  );

  const readText = useCallback(
    async (dataUrl: string, label: string): Promise<void> => {
      setCaptureText({ label, text: '', engine: null, translated: null, failure: null, notice: null });
      setCaptureTextBusy(true);
      try {
        const outcome = await window.electronAPI.runImageOcr(dataUrl);
        if (outcome.ok) {
          setCaptureText({
            label,
            text: outcome.text ?? '',
            engine: outcome.engine ?? null,
            provider: outcome.provider,
            translated: null,
            failure: null,
            notice: null,
          });
        } else {
          setCaptureText({
            label,
            text: '',
            engine: null,
            translated: null,
            failure:
              outcome.reason === 'blocked'
                ? TEXT.VIEWER_OCR_BLOCKED
                : outcome.reason === 'empty'
                  ? TEXT.VIEWER_OCR_EMPTY
                  : outcome.reason === 'no_engine'
                    ? TEXT.VIEWER_OCR_UNAVAILABLE
                    : outcome.message ?? TEXT.VIEWER_OCR_UNAVAILABLE,
            notice: null,
          });
        }
      } catch (error) {
        setCaptureText({
          label,
          text: '',
          engine: null,
          translated: null,
          failure: String((error as Error)?.message ?? error).slice(0, 200),
          notice: null,
        });
      } finally {
        setCaptureTextBusy(false);
      }
    },
    []
  );

  /** Chip quick action: read the attachment's text in place (no window). */
  const readAttachmentText = useCallback(
    async (index: number): Promise<void> => {
      const attachment = attachments[index];
      if (!attachment || attachment.type === 'pdf') {
        return;
      }
      const label =
        attachment.type === 'screen-capture' && attachment.capture?.label
          ? attachment.capture.label
          : TEXT.ATTACHMENT_IMAGE;
      await readText(attachment.data, label);
    },
    [attachments, readText]
  );

  const dismissCaptureText = useCallback((): void => setCaptureText(null), []);

  const runCaptureTextAction = useCallback(
    async (action: 'copy' | 'insert' | 'search' | 'translate', text: string): Promise<void> => {
      const showFailure = (message: string): void =>
        setCaptureText((current) => (current ? { ...current, notice: message } : current));
      let outcome: { ok: boolean; text?: string; message?: string };
      try {
        outcome = await window.electronAPI.runImageTextAction({ action, text });
      } catch (error) {
        showFailure(error instanceof Error && error.message ? error.message : TEXT.VIEWER_ACTION_FAILED);
        return;
      }
      if (action === 'translate') {
        if (!outcome.ok) {
          showFailure(outcome.message ?? TEXT.VIEWER_ACTION_FAILED);
        }
        setCaptureText((current) =>
          current ? { ...current, translated: outcome.ok ? outcome.text ?? '' : null } : current
        );
        return;
      }
      if (!outcome.ok) {
        showFailure(outcome.message ?? TEXT.VIEWER_ACTION_FAILED);
        return;
      }
      if (action === 'copy') {
        setCaptureText((current) => (current ? { ...current, notice: TEXT.VIEWER_COPIED } : current));
        window.setTimeout(
          () => setCaptureText((current) => (current ? { ...current, notice: null } : current)),
          1600
        );
        return;
      }
      dismissCaptureText();
      composerRef.current?.focus();
    },
    [dismissCaptureText]
  );

  /**
   * One entry point for the capture grid: region, the OS text mode, a chosen
   * source, or the display. `text` runs OCR in the viewer instead of stopping
   * at the image.
   */
  const captureChoice = useCallback(
    async (choice: { kind: 'text' | 'region' | 'display' } | { kind: 'source'; id: string }): Promise<void> => {
      const intent =
        choice.kind === 'text' || choice.kind === 'region'
          ? 'region'
          : choice.kind === 'display'
            ? 'display'
            : 'source';
      const outcome = await window.electronAPI.beginCapture({
        intent,
        ...(choice.kind === 'source' ? { sourceId: choice.id } : {}),
      });
      if (!outcome.ok) {
        appendCapture(outcome);
        return;
      }
      appendCapture(outcome);
      if (choice.kind === 'text') {
        await readText(outcome.dataUrl, outcome.meta.label);
      }
      composerRef.current?.focus();
    },
    [appendCapture, attachments.length]
  );

  useLayoutEffect(() => {
    const subscribe = window.electronAPI.onViewerApplied;
    if (!subscribe) {
      return;
    }
    const unsubscribe = subscribe((payload) => {
      const target = viewerTargetRef.current;
      if (!target || target.token !== payload.token) {
        return;
      }
      viewerTargetRef.current = null;
      setAttachments((prev) =>
        replaceEditedAttachment(prev, target.index, { ...payload, previousData: target.data })
      );
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    const api = window.electronAPI;
    if (!api?.onDictationState) {
      return undefined;
    }
    const apply = (snapshot: DictationSnapshot): void => {
      const mapped: VoiceState =
        snapshot.phase === 'recording'
          ? 'recording'
          : snapshot.phase === 'transcribing' || snapshot.phase === 'sending'
            ? 'transcribing'
            : 'idle';
      setVoiceState(mapped);
      setVoiceLevel(snapshot.level);
      setVoiceInterim(snapshot.phase === 'recording' ? snapshot.interim : '');
      if (mapped !== 'recording') {
        voiceStateRef.current = mapped;
      } else {
        voiceStateRef.current = 'recording';
      }
    };
    void api
      .getDictation?.()
      .then((snapshot) => {
        if (snapshot) {
          dictationRef.current = snapshot;
          apply(snapshot);
        }
      })
      .catch(() => undefined);
    return api.onDictationState((snapshot) => {
      dictationRef.current = snapshot;
      apply(snapshot);
    });
  }, []);

  useLayoutEffect(() => {
    const subscribe = window.electronAPI?.onDictationStopRequest;
    if (!subscribe) {
      return undefined;
    }
    // The launcher's mic button asked this window (the owner) to commit.
    return subscribe(() => {
      void finishRecordingRef.current();
    });
  }, []);

  useLayoutEffect(() => {
    const subscribe = window.electronAPI.onLauncherComposeText;
    if (!subscribe) {
      return;
    }
    const unsubscribe = subscribe(({ text, mode }) => {
      if (!text) {
        return;
      }
      setInput((prev) => (mode === 'append' && prev.trim().length > 0 ? `${prev.trimEnd()}\n${text}` : text));
      window.setTimeout(() => {
        const input = composerRef.current;
        if (!input) {
          return;
        }
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }, 0);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    const subscribe = window.electronAPI.onCaptureResult;
    if (!subscribe) {
      return;
    }
    const unsubscribe = subscribe((outcome) => {
      appendCapture(outcome as CaptureOutcome);
      composerRef.current?.focus();
    });
    return () => {
      unsubscribe();
    };
  }, [appendCapture]);

  // Every launcher listener above is mounted: main may deliver what it queued
  // for a cold window (a capture hand-off, text for the composer). A reload
  // re-runs this, so nothing is dropped across `did-start-loading`.
  useEffect(() => {
    void window.electronAPI?.launcherReady?.().catch(() => undefined);
  }, []);

  const selectSession = useCallback(async (id: string) => {
    const conv = await manager.loadAndSetActiveConversation(id);
    if (conv) {
      setActiveId(conv.id);
      await Promise.all([refreshMessages(), refreshBranchTree()]);
    }
    onSessionChanged?.();
  }, [manager, onSessionChanged, refreshMessages, refreshBranchTree]);

  const editMessage = useCallback(
    async (messageId: string, content: string): Promise<void> => {
      try {
        const result = await window.electronAPI.editMessage({ messageId, content });
        if (result.queued) {
          NotificationService.showInfo(TEXT.TURN_QUEUED);
        }
        await manager.loadAndSetActiveConversation(result.conversationId);
        await Promise.all([refreshMessages(), refreshBranchTree(), refreshConversations()]);
      } catch (error) {
        NotificationService.showError(interpolate(TEXT.SESSION_TURN_ERROR, { error: (error as Error).message }));
      }
    },
    [manager, refreshMessages, refreshBranchTree, refreshConversations]
  );

  const regenerateMessage = useCallback(
    async (messageId: string): Promise<void> => {
      try {
        const result = await window.electronAPI.regenerateMessage({ messageId });
        if (result.queued) {
          NotificationService.showInfo(TEXT.TURN_QUEUED);
        }
        await manager.loadAndSetActiveConversation(result.conversationId);
        await Promise.all([refreshMessages(), refreshBranchTree(), refreshConversations()]);
      } catch (error) {
        NotificationService.showError(interpolate(TEXT.SESSION_TURN_ERROR, { error: (error as Error).message }));
      }
    },
    [manager, refreshMessages, refreshBranchTree, refreshConversations]
  );

  const selectVariant = useCallback(
    async (messageId: string): Promise<void> => {
      try {
        const result = await window.electronAPI.selectMessage(messageId);
        await manager.loadAndSetActiveConversation(result.conversationId);
        await Promise.all([refreshMessages(), refreshBranchTree()]);
      } catch (error) {
        NotificationService.showError(interpolate(TEXT.SESSION_TURN_ERROR, { error: (error as Error).message }));
      }
    },
    [manager, refreshMessages, refreshBranchTree]
  );

  const deleteSession = useCallback(async (id: string) => {
    await manager.deleteConversation(id);
    await refreshConversations();
    const active = manager.getActiveConversation();
    if (!active || active.id === id) {
      const next = await manager.loadOrCreateConversation();
      setActiveId(next.id);
      await refreshMessages();
    }
    await refreshBranchTree();
    setDeletingSession(null);
    NotificationService.showSuccess(TEXT.SESSION_DELETED);
  }, [manager, refreshConversations, refreshMessages, refreshBranchTree]);

  const { renameConversation, duplicateConversation, exportConversation } = useConversationActions({
    manager,
    activeId,
    conversations,
    messages,
    selectSession,
    refreshConversations,
  });

  /** Renderer-owned conversation actions (plan 74) — `/clear`, `/delete`, `/export`. */
  const runConversationAction = useCallback(
    async (entry: CommandEntry): Promise<boolean> => {
      switch (entry.action) {
        case 'nav:clear-conversation':
          setInput('');
          setConfirmClear(true);
          return true;
        case 'nav:delete-conversation': {
          const id = manager.getActiveConversation()?.id ?? activeId;
          setInput('');
          if (id !== null) {
            setDeletingSession(id);
          }
          return true;
        }
        case 'nav:export-conversation':
          setInput('');
          await exportConversation();
          return true;
        case 'nav:duplicate-conversation':
          setInput('');
          await duplicateConversation();
          return true;
        default:
          return false;
      }
    },
    [activeId, duplicateConversation, exportConversation, manager]
  );

  const clearConversation = useCallback(async () => {
    await manager.clearActiveConversationMessages();
    await Promise.all([refreshMessages(), refreshBranchTree()]);
    setConfirmClear(false);
    onSessionChanged?.();
  }, [manager, onSessionChanged, refreshMessages, refreshBranchTree]);

  const setConversationModel = useCallback(async (modelId: string | null): Promise<void> => {
    const active = manager.getActiveConversation();
    if (!active || active.id.startsWith('temp-')) {
      return;
    }
    const metadata = { ...active.metadata };
    if (modelId) {
      metadata.modelId = modelId;
    } else {
      delete metadata.modelId;
    }
    active.metadata = metadata;
    await window.electronAPI.setConversationMetadata(active.id, metadata);
    await refreshConversations();
  }, [manager, refreshConversations]);

  /** Per-conversation speak toggle (plan 24 S5 follow-up). */
  const setConversationSpeak = useCallback(
    (speak: boolean | null): Promise<void> =>
      applyConversationMetadata({ speakMode: speak === true ? 'on' : 'off' }),
    [applyConversationMetadata]
  );

  /** Per-conversation persona (plan 12 §7): empty string clears it. */
  const setConversationPersona = useCallback(
    async (systemPrompt: string): Promise<void> => {
      const active = manager.getActiveConversation();
      if (!active || active.id.startsWith('temp-')) {
        return;
      }
      const metadata = { ...active.metadata };
      const persona = systemPrompt.trim();
      if (persona) {
        metadata.systemPrompt = persona;
      } else {
        delete metadata.systemPrompt;
      }
      active.metadata = metadata;
      await window.electronAPI.setConversationMetadata(active.id, metadata);
    },
    [manager]
  );

  const liveView: ChatMessageView | null = useMemo(() => {
    if (!live.live || (live.live.status !== 'pending' && live.live.status !== 'streaming')) {
      return null;
    }
    return {
      id: 'live-turn',
      role: 'assistant',
      content: live.live.text ?? '',
      status: 'streaming',
    };
  }, [live.live]);

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i];
      }
    }
    return null;
  }, [messages]);

  const lastMeta = (lastAssistant?.meta as unknown as TurnMetadata | undefined) ?? undefined;
  const sending = live.live?.status === 'pending' || live.live?.status === 'streaming';
  const traceStore = traceStoreRef.current;

  const pendingApproval = trace.interrupt;
  const resolveApproval = useCallback(
    (resolution: ApprovalResolution): void => {
      traceStore.clearInterrupt();
      void window.electronAPI.resumeTurn(resolution);
    },
    [traceStore]
  );

  const selectionCaptureEnabled = config?.behavior?.selectionCapture === true && selectionSupported;
  const liveActive = liveSnapshot !== null && liveSnapshot.state !== 'idle' && liveSnapshot.state !== 'error';
  const liveFullDuplex = liveSnapshot !== null && !liveSnapshot.downgraded;
  const showVoiceInterim =
    !liveActive || liveSnapshot?.state === 'listening' || liveSnapshot?.state === 'transcribing';
  const insertSelection = useCallback(async (): Promise<string | null> => {
    const result = await window.electronAPI.captureSelection();
    if (result.ok && result.text) {
      setInput((prev) => (prev ? `${prev}\n${result.text}` : result.text ?? ''));
      composerRef.current?.focus();
      return null;
    }
    return result.error ?? TEXT.CONTEXT_NO_SELECTION;
  }, []);

  return {
    manager,
    conversations,
    activeId,
    messages,
    config,
    attachments,
    setAttachments,
    input,
    setInput,
    voiceState,
    voiceLevel,
    voiceInterim: sentTranscript ?? (showVoiceInterim ? voiceInterim : ''),
    voiceInterimSent: sentTranscript !== null,
    voiceAvailable: (config?.voice?.enabled ?? true) && Boolean(config?.taskAssignments?.stt),
    insertSelection: selectionCaptureEnabled ? insertSelection : null,
    captureChoice,
    openAttachment,
    copyAttachmentImage,
    readAttachmentText,
    captureText,
    captureTextBusy,
    runCaptureTextAction,
    dismissCaptureText,
    confirmClear,
    setConfirmClear,
    deletingSession,
    setDeletingSession,
    composerRef,
    trace,
    traceStore,
    live,
    liveView,
    sending,
    lastAssistant,
    lastMeta,
    submit,
    runCommandEntry,
    editMessage,
    regenerateMessage,
    selectVariant,
    branchTree,
    refreshBranchTree,
    toggleRecording,
    startPushToTalk,
    stopPushToTalk,
    cancelRecording,
    clearInterim,
    handleFiles,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
    renameConversation,
    duplicateConversation,
    exportConversation,
    setConversationModel,
    setConversationPersona,
    setConversationSpeak,
    refreshConversations,
    refreshMessages,
    pendingApproval,
    resolveApproval,
    speechState: liveActive
      ? speechState
      : busSpeech.state === 'synthesizing'
        ? 'loading'
        : busSpeech.state,
    speechProgress:
      !liveActive && busSpeech.state !== 'idle'
        ? {
            current: Math.min(
              Math.max(busSpeech.chunkIndex + 1, 1),
              Math.max(busSpeech.chunkCount, 1)
            ),
            total: Math.max(busSpeech.chunkCount, 1),
          }
        : undefined,
    toggleSpeechPause: (): void => {
      if (liveActive) {
        return;
      }
      void window.electronAPI.controlSpeech?.(busSpeech.state === 'paused' ? 'resume' : 'pause');
    },
    stopSpeaking,
    speakText,
    liveSnapshot,
    liveActive,
    liveFullDuplex,
    liveIgnoredHint,
    startLive,
    stopLive,
    interruptLive,
    setLiveFullDuplex,
  };
}

function enabledProviderCount(config: AppConfig | null): number {
  return (config?.search?.providers ?? []).filter((provider) => provider.enabled).length;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function liveNoticeText(code: LiveNoticeCode): string {
  switch (code) {
    case 'mic_denied':
      return TEXT.LIVE_NOTICE_MIC_DENIED;
    case 'mic_lost':
      return TEXT.LIVE_NOTICE_MIC_LOST;
    case 'stt_failed':
      return TEXT.LIVE_NOTICE_STT_FAILED;
    case 'idle_timeout':
      return TEXT.LIVE_NOTICE_IDLE_TIMEOUT;
    case 'echo_detected':
      return TEXT.LIVE_NOTICE_ECHO_DETECTED;
    case 'barge_in_unavailable':
      return TEXT.LIVE_NOTICE_BARGE_IN_UNAVAILABLE;
    case 'tts_failed':
      return TEXT.LIVE_NOTICE_TTS_FAILED;
    case 'turn_failed':
      return TEXT.LIVE_NOTICE_TURN_FAILED;
    case 'provider_unavailable':
      return TEXT.LIVE_NOTICE_PROVIDER_UNAVAILABLE;
    case 'cost_cap':
      return TEXT.LIVE_NOTICE_COST_CAP;
    case 'no_speech':
    case 'live_intent_failed':
      return '';
  }
}
