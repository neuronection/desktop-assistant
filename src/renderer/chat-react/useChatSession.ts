import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChatMessageView, useChatStream } from '@neuronection/assistant-ui/chat-core';
import { AppConfig } from '@shared/config/AppConfig';
import { Message, MessageRole, Attachment, RecordingState } from '@shared/types';
import type { ApprovalResolution, TurnMetadata, TurnStartRequest } from '@shared/turns';
import type { CommandEntry } from '@shared/commands';
import { NotificationService } from '@renderer/services/NotificationService';
import { ConversationManager } from '@renderer/managers/ConversationManager';
import { RecordingManager } from '@renderer/managers/RecordingManager';
import { createIpcTransport } from './ipcTransport';
import { createTurnTraceStore } from './turnTraceStore';
import { cachedCommandCatalog, formatSlashEntry, invalidateCommandCatalog, loadCommandCatalog, resolveSlashInput, webSearchBrowserOverride } from './commandSource';
import { miniAppForEntry } from './miniApps';
import type { SlashResolution } from './commandSource';
import { attachmentDisplayName } from './MessageAttachments';
import type { VoiceState } from './VoiceIndicator';
import { TEXT, interpolate } from '@shared/constants/text';

export interface UseChatSessionOptions {
  onSessionChanged?: () => void;
  /** Fired when the voice auto-send flow submits a turn (UI state hook). */
  onAutoSendSubmit?: () => void;
  /** Fired right before a real turn starts (not for builtin commands) — UI state hook. */
  onTurnSubmitting?: () => void;
  /** Fired when a mini-app command is invoked without arguments (plan 14 §9) — UI enters the mode. */
  onMiniAppRequest?: (entry: CommandEntry) => void;
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
    })));
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
      await Promise.all([refreshConversations(), refreshMessages()]);
    })();
  }, [manager, refreshConversations, refreshMessages]);

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
      void maybeAutoSendRef.current?.(text);
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
    recorder.on('state:change', onVoiceState);
    recorder.on('volume:change', onVolume);
    recorder.on('interim:transcript', onInterim);
    recorder.on('recording:error', onVoiceError);
    recorder.on('transcript:error', onVoiceError);
    return () => {
      recorder.off('state:change', onVoiceState);
      recorder.off('volume:change', onVolume);
      recorder.off('interim:transcript', onInterim);
      recorder.off('recording:error', onVoiceError);
      recorder.off('transcript:error', onVoiceError);
      if (levelFrame) {
        cancelAnimationFrame(levelFrame);
      }
    };
  }, []);

  const pendingDirectRef = useRef<TurnStartRequest['directTool'] | null>(null);

  const buildTurnRequest = useCallback((text: string): TurnStartRequest | null => {
    const active = manager.getActiveConversation();
    if (!active) {
      return null;
    }
    const direct = pendingDirectRef.current ?? undefined;
    pendingDirectRef.current = null;

    return {
      conversationId: active.id,
      content: text,
      attachments,
      modelId: active.metadata?.modelId ?? '',
      ...(direct ? { directTool: direct } : {}),
    };
  }, [attachments, manager]);

  /** Runs a builtin through `commands:execute` and surfaces the outcome (notices, clipboard). */
  const runBuiltinCommand = useCallback(async (entryId: string, argv: string[]): Promise<void> => {
    const outcome = await window.electronAPI.executeCommand(entryId, argv, 'palette');
    if (outcome.status === 'error') {
      NotificationService.showError(outcome.error);
      return;
    }
    if (outcome.status === 'done' && outcome.text) {
      await window.electronAPI.writeToClipboard(outcome.text).catch(() => undefined);
      NotificationService.showSuccess(`${outcome.text} — ${TEXT.COMMAND_COPY_DONE}`);
    }
  }, []);


  const turnSourceIdRef = useRef<string | null>(null);
  const pendingLocalIdRef = useRef<string | null>(null);

  const handleTurnFinished = useCallback(
    async (conversationId: string) => {
      if (turnSourceIdRef.current === null || manager.getActiveConversation()?.id === turnSourceIdRef.current) {
        await manager.loadAndSetActiveConversation(conversationId);
        await refreshMessages();
      }
      await refreshConversations();
      turnSourceIdRef.current = null;
    },
    [manager, refreshConversations, refreshMessages]
  );

  const transport = useMemo(
    () =>
      createIpcTransport({
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
          await handleTurnFinished(outcome.conversationId);
        },
        onTurnRejected: () => {
          if (pendingLocalIdRef.current) {
            manager.removeLocalMessage(pendingLocalIdRef.current);
            pendingLocalIdRef.current = null;
          }
          turnSourceIdRef.current = null;
          void refreshMessages();
        },
        onTurnEvent: (event) => traceStoreRef.current.handleEvent(event),
      }),
    [attachments, buildTurnRequest, handleTurnFinished, manager, refreshMessages]
  );

  const live = useChatStream({
    transport,
    flushMs: 33,
    timeoutMs: 120000,
  });

  const submit = useCallback(
    async (text: string) => {
      if (!text.trim() && attachments.length === 0) {
        return;
      }
      if (live.live?.status === 'pending' || live.live?.status === 'streaming') {
        NotificationService.showError(TEXT.COMMAND_TURN_IN_PROGRESS);
        return;
      }
      if (text.trimStart().startsWith('/')) {
        // A pending invalidation (config save) or first use may leave the
        // cache cold — never degrade typed slash input into a chat message.
        if (!cachedCommandCatalog()) {
          await loadCommandCatalog().catch(() => undefined);
        }
        const resolved = resolveSlashInput(text, config?.commands?.argDefaults);
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
            onTurnSubmittingRef.current?.();
            await live.send(outcome.prompt);
            setInput('');
            return;
          }
          if (outcome.direct) {
            pendingDirectRef.current = { ...outcome.direct, commandId: resolved.entry.id };
            onTurnSubmittingRef.current?.();
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
          pendingDirectRef.current = resolved.direct;
        }
      }
      onTurnSubmittingRef.current?.();
      await live.send(text);
      setInput('');
    },
    [attachments.length, config, live, runBuiltinCommand]
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
      const outcome = await window.electronAPI.executeCommand(entry.id, argv, 'palette');
      if (outcome.status === 'error') {
        NotificationService.showError(outcome.error);
        return;
      }
      if (outcome.status === 'turn' && outcome.prompt) {
        setInput('');
        onTurnSubmittingRef.current?.();
        await live.send(outcome.prompt);
        return;
      }
      if (outcome.status === 'turn' && outcome.direct) {
        pendingDirectRef.current = { ...outcome.direct, commandId: entry.id };
        onTurnSubmittingRef.current?.();
        await live.send(formatSlashEntry(entry, argv) || entry.title);
        setInput('');
        return;
      }
      if (outcome.status !== 'done') {
        return;
      }
      setInput('');
      if (outcome.text) {
        if (entry.action === 'calc:evaluate') {
          await window.electronAPI.writeToClipboard(outcome.text).catch(() => undefined);
          NotificationService.showSuccess(`${outcome.text} — ${TEXT.COMMAND_COPY_DONE}`);
        } else {
          NotificationService.showSuccess(outcome.text.slice(0, 200));
        }
      }
    },
    [live, submit]
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
    [submit]
  );
  maybeAutoSendRef.current = maybeAutoSend;

  const applyTranscript = useCallback((transcript: string): void => {
    setInput((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
    composerRef.current?.focus();
  }, []);

  const toggleRecording = useCallback(async () => {
    const recorder = RecordingManager.getInstance();
    if (recorder.isRecording()) {
      const transcript = await recorder.stopRecording();
      if (transcript) {
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
          return applyTranscript(transcript);
        }
        return applyTranscript(final);
      }
      return;
    }
    if (!recorder.isProcessing()) {
      try {
        await recorder.startRecording();
      } catch {
        return;
      }
    }
  }, []);

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

  const newConversation = useCallback(async () => {
    const conv = manager.createNewConversation();
    setActiveId(conv.id);
    onSessionChanged?.();
    await refreshConversations();
    await refreshMessages();
  }, [manager, onSessionChanged, refreshConversations, refreshMessages]);

  const selectSession = useCallback(async (id: string) => {
    const conv = await manager.loadAndSetActiveConversation(id);
    if (conv) {
      setActiveId(conv.id);
      await refreshMessages();
    }
    onSessionChanged?.();
  }, [manager, onSessionChanged, refreshMessages]);

  const deleteSession = useCallback(async (id: string) => {
    await manager.deleteConversation(id);
    await refreshConversations();
    const active = manager.getActiveConversation();
    if (!active || active.id === id) {
      const next = await manager.loadOrCreateConversation();
      setActiveId(next.id);
      await refreshMessages();
    }
    setDeletingSession(null);
    NotificationService.showSuccess(TEXT.SESSION_DELETED);
  }, [manager, refreshConversations, refreshMessages]);

  const clearConversation = useCallback(async () => {
    await manager.clearActiveConversationMessages();
    await refreshMessages();
    setConfirmClear(false);
    onSessionChanged?.();
  }, [manager, onSessionChanged, refreshMessages]);

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
    voiceInterim,
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
    toggleRecording,
    cancelRecording,
    clearInterim,
    handleFiles,
    captureScreen,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
    setConversationModel,
    refreshConversations,
    refreshMessages,
    pendingApproval,
    resolveApproval,
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
