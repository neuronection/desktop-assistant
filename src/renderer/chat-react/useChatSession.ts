import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BranchTree, ChatMessageView, buildBranchTree, useChatStream } from '@neuronection/assistant-ui/chat-core';
import { AppConfig } from '@shared/config/AppConfig';
import { Message, MessageRole, Attachment, RecordingState } from '@shared/types';
import type { ApprovalResolution, TurnStartRequest } from '@shared/turns';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { type LiveNoticeCode, type LiveSnapshot } from '@shared/live';
import type { CommandEntry } from '@shared/commands';
import { NotificationService } from '@renderer/services/NotificationService';
import { beginDialog, endDialog } from './dialogGuard';
import { ConversationManager } from '@renderer/managers/ConversationManager';
import { RecordingManager } from '@renderer/managers/RecordingManager';
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
  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceInterim, setVoiceInterim] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [selectionSupported, setSelectionSupported] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const interimRef = useRef('');
  const voiceStateRef = useRef<VoiceState>('idle');
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
    const onVoiceState = (state: RecordingState): void => {
      setVoiceState(state === RecordingState.RECORDING ? 'recording' : state === RecordingState.PROCESSING ? 'transcribing' : 'idle');
      voiceStateRef.current = state === RecordingState.RECORDING ? 'recording' : state === RecordingState.PROCESSING ? 'transcribing' : 'idle';
      if (state !== RecordingState.RECORDING) {
        setVoiceLevel(0);
        setVoiceInterim('');
        interimRef.current = '';
      }
    };
    const onInterim = (text: string): void => {
      setVoiceInterim(text);
      interimRef.current = text;
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
          if (resolved.entry.action === 'nav:new-conversation') {
            setInput('');
            await newConversation();
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
            const query = text.trimStart().replace(/^\/\S+\s*/, '');
            if (!query.trim()) {
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
  const runCommandEntry = useCallback(
    async (entry: CommandEntry, argv: string[]): Promise<void> => {
      if (miniContextRef.current?.()?.active && !(miniContextRef.current?.()?.allowedIds ?? []).includes(entry.id)) {
        NotificationService.showError(
          interpolate(TEXT.COMMAND_MINI_BLOCKED, { command: entry.slash ?? entry.aliases[0] ?? entry.title, app: miniContextRef.current?.()?.appName ?? 'the mini app' })
        );
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
    [beginTurn, sendFlowTurn, submit, newConversation, selectConversation]
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
      try {
        finalText = await RecordingManager.getInstance().stopRecording();
      } catch {
        return;
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

  const finishRecording = useCallback(async (): Promise<void> => {
    const recorder = RecordingManager.getInstance();
    const transcript = await recorder.stopRecording();
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

  const toggleRecording = useCallback(async () => {
    const recorder = RecordingManager.getInstance();
    if (recorder.isRecording()) {
      await finishRecording();
      return;
    }
    if (!recorder.isProcessing()) {
      try {
        await recorder.startRecording();
      } catch {
        return;
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
    if (recorder.isRecording() || recorder.isProcessing()) {
      return false;
    }
    try {
      await recorder.startRecording();
      return true;
    } catch {
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
    try {
      RecordingManager.getInstance().cancelRecording();
    } catch {
      return;
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

  const captureScreen = useCallback(async (sourceId: string): Promise<void> => {
    setPickerOpen(false);
    const dataUrl = await window.electronAPI.captureHighResSource(sourceId);
    setAttachments((prev) => [...prev, { type: 'screen-capture', data: dataUrl, sourceId }]);
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
    pickerOpen,
    setPickerOpen,
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
    captureScreen,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
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
