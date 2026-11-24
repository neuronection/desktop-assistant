import { isDecisionModel, modelSelectionKey, resolveTaskModel } from '@shared/ai/tasks';
import { formatModelLabel, providerDisplayNames } from '@shared/ai/modelLabel';
import { AiTask } from '@shared/types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ChatPanel } from '@neuronection/assistant-ui/chat-panel';
import { ChatSessionList } from '@neuronection/assistant-ui/chat-session-list';
import { ChatTranscript } from '@neuronection/assistant-ui/chat-transcript';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import { MessageBubble } from './MessageBubble';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { StreamedContent } from './StreamedContent';
import type { ChatToolCatalogEntry } from '@neuronection/assistant-ui/chat-tools-catalog';
import { History, Loader2, Maximize2, Minimize2, Minus, PanelRightClose, PanelRightOpen, Settings, SquarePen, Volume2, X } from 'lucide-react';
import { ViewSwitcher } from '@renderer/shared/ViewSwitcher';

import { ConversationRailFooter } from '@renderer/shared/ConversationRailFooter';
import { useChatSession } from './useChatSession';
import { useCommandPalette } from './useCommandPalette';
import { CommandPalette } from './CommandPalette';
import { useMiniApps } from './useMiniApps';
import { useWindowHeaderDrag } from './useWindowHeaderDrag';
import { TraceTimeline, ExpandableTraceMeta } from './TraceTimeline';
import { FlowCard, hasFlowTimeline } from './FlowCard';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { Composer } from './Composer';
import { MessageAttachments } from './MessageAttachments';
import { Inspector } from './Inspector';
import { SCROLL_STICK_THRESHOLD_PX } from './launcherLayout';
import { ApprovalCard } from './ApprovalCard';
import { DownloadCard, findActiveDownload } from './DownloadCard';
import { ArtifactChips } from './ArtifactChips';
import { MiniAppRunCard } from './MiniAppRunCard';
import { openRunReportWindow } from '@renderer/shared/runReportHost';
import { RunReportModal } from '@renderer/shared/RunReportModal';
import { SetupEmptyStateCta } from './SetupEmptyStateCta';
import type { MessageSearchHit } from '@shared/messageSearch';
import { OnboardingCard } from './OnboardingCard';
import { useWindowSelection } from './useWindowSelection';
import { slashExampleFor } from '@shared/commands';
import { TEXT } from '@shared/constants/text';
import { useLatestRef } from './useLatestRef';

export function DesktopApp(): JSX.Element {
  const session = useChatSession({
    onMiniAppRequest: (entry, openOptions) => miniApps.enterMiniApp(entry, openOptions),
    isMiniAppActive: () => miniApps.isMiniAppActive(),
    onMiniAppExit: () => miniApps.exitMiniApp(),
    miniContext: () => miniApps.miniContext(),
  });
  const miniApps = useMiniApps({
    input: session.input,
    setInput: session.setInput,
    composerRef: session.composerRef,
    config: session.config,
    onSpeak: (text) => void session.speakText(text),
  });
  const palette = useCommandPalette({
    input: session.input,
    setInput: session.setInput,
    composerRef: session.composerRef,
    executeEntry: session.runCommandEntry,
    sending: session.sending,
    allowedIds: miniApps.paletteAllowedIds,
    extraEntries: miniApps.miniExitEntries,
  });
  const onHeaderPointerDown = useWindowHeaderDrag();
  const [messageQuery, setMessageQuery] = useState('');
  const [messageHits, setMessageHits] = useState<MessageSearchHit[]>([]);
  const [messageSearching, setMessageSearching] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const messageRequest = useRef(0);

  useEffect(() => {
    const query = messageQuery.trim();
    if (query.length < 2) {
      setMessageHits([]);
      setMessageError(null);
      setMessageSearching(false);
      return undefined;
    }
    const request = ++messageRequest.current;
    setMessageSearching(true);
    setMessageError(null);
    const timer = setTimeout(() => {
      window.electronAPI
        .searchMessagesByContent(query)
        .then((hits) => {
          if (request !== messageRequest.current) {
            return;
          }
          setMessageHits(hits);
          setMessageSearching(false);
        })
        .catch((cause: Error) => {
          if (request !== messageRequest.current) {
            return;
          }
          setMessageError(cause.message);
          setMessageHits([]);
          setMessageSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [messageQuery]);

  const [showInspector, setShowInspector] = useState(false);
  const [sessionsVisible, setSessionsVisible] = useState(true);

  useEffect(() => {
    if (typeof window.electronAPI.getUiState !== 'function') {
      return undefined;
    }
    let cancelled = false;
    void window.electronAPI
      .getUiState()
      .then((state) => {
        if (cancelled) {
          return;
        }
        if (typeof state.desktopHistoryVisible === 'boolean') {
          setSessionsVisible(state.desktopHistoryVisible);
        }
        if (typeof state.inspectorVisible === 'boolean') {
          setShowInspector(state.inspectorVisible);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const applySessionsVisible = useCallback((visible: boolean): void => {
    setSessionsVisible(visible);
    if (typeof window.electronAPI.saveUiState === 'function') {
      void window.electronAPI.saveUiState({ desktopHistoryVisible: visible }).catch(() => undefined);
    }
  }, []);

  const applyInspectorVisible = useCallback((visible: boolean): void => {
    setShowInspector(visible);
    if (typeof window.electronAPI.saveUiState === 'function') {
      void window.electronAPI.saveUiState({ inspectorVisible: visible }).catch(() => undefined);
    }
  }, []);
  const [fullScreen, setFullScreen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [catalog, setCatalog] = useState<ChatToolCatalogEntry[]>([]);
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const {
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
    voiceAvailable,
    insertSelection,
    confirmClear,
    setConfirmClear,
    deletingSession,
    setDeletingSession,
    composerRef,
    trace,
    live,
    liveView,
    sending,
    lastAssistant,
    submit,
    toggleRecording,
    cancelRecording,
    clearInterim,
    speechState,
    speechProgress,
    toggleSpeechPause,
    stopSpeaking,
    speakText,
    liveSnapshot,
    liveActive,
    liveFullDuplex,
    liveIgnoredHint,
    voiceInterimSent,
    startLive,
    stopLive,
    interruptLive,
    setLiveFullDuplex,
    setConversationPersona,
    setConversationSpeak,
    handleFiles,
    captureChoice,
    openAttachment,
    copyAttachmentImage,
    readAttachmentText,
    captureText,
    captureTextBusy,
    runCaptureTextAction,
    dismissCaptureText,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
    renameConversation,
    duplicateConversation,
    exportConversation,
    setConversationModel,
    pendingApproval,
    resolveApproval,
    branchTree,
    editMessage,
    regenerateMessage,
    selectVariant,
  } = session;

  const activeDownload = useMemo(() => findActiveDownload(trace.steps), [trace]);
  const selection = useWindowSelection(true);
  const speakSelection = (text: string): void => {
    window.getSelection()?.removeAllRanges();
    void speakText(text);
  };

  const selectSessionRef = useLatestRef(selectSession);
  const newConversationRef = useLatestRef(newConversation);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionSync((conversationId) => {
      void selectSessionRef.current(conversationId);
    });
    return unsubscribe;
  }, [selectSessionRef]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherNewConversation?.(() => {
      void newConversationRef.current();
    });
    return () => unsubscribe?.();
  }, [newConversationRef]);

  const miniAppRef = useLatestRef(miniApps.miniApp);
  const optionsOpenRef = useLatestRef(miniApps.optionsOpen);
  const exitMiniAppRef = useLatestRef(miniApps.exitMiniApp);
  const liveActiveRef = useLatestRef(liveActive);
  const liveSnapshotRef = useLatestRef(liveSnapshot);
  const interruptLiveRef = useLatestRef(interruptLive);
  const stopLiveRef = useLatestRef(stopLive);

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      if (optionsOpenRef.current) {
        return;
      }
      if (miniAppRef.current) {
        event.preventDefault();
        event.stopPropagation();
        exitMiniAppRef.current();
        return;
      }
      if (!liveActiveRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (liveSnapshotRef.current?.state === 'speaking') {
        interruptLiveRef.current();
      } else {
        stopLiveRef.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('conversation');
    if (initial) {
      void selectSession(initial);
    }
  }, [selectSession]);

  useEffect(() => {
    void window.electronAPI.getToolCatalog().then((rows) => {
      setCatalog(
        rows.map((row) => ({
          name: row.name,
          description: row.description,
          scope: row.risk,
          example: slashExampleFor(row.name),
        }))
      );
    });
  }, []);

  const activeTitle =
    conversations.find((conversation) => conversation.id === activeId)?.title ??
    manager.getActiveConversation()?.title ??
    TEXT.DESKTOP_APP_TITLE;
  const metadata = manager.getActiveConversation()?.metadata;
  const selected = metadata?.modelId
    ? metadata.modelProviderId
      ? modelSelectionKey(metadata.modelProviderId, metadata.modelId)
      : metadata.modelId
    : null;
  const active = config ? resolveTaskModel(config, AiTask.CHAT, selected) : null;
  const activeModel = active ? modelSelectionKey(active.provider.id, active.model.id) : null;
  const providerNames = useMemo(
    () => providerDisplayNames(config?.providers ?? []),
    [config]
  );
  const activeModelLabel = active
    ? formatModelLabel(providerNames.get(active.provider.id) ?? active.provider.name, active.model.name)
    : null;
  const pickerProviders = useMemo(
    () =>
      (config?.providers ?? []).map((provider) => ({
        id: provider.id,
        name: providerNames.get(provider.id) ?? provider.name,
        models: [...new Map(
          [...(provider.customModels ?? []), ...(provider.availableModels ?? [])]
            .filter((model) => !isDecisionModel(provider, model))
            .map((model) => [model.id, model])
        ).values()].map((model) => ({
          id: modelSelectionKey(provider.id, model.id),
          name: model.name,
        })),
      })),
    [config, providerNames]
  );

  const toggleFullScreen = useCallback((): void => {
    void window.electronAPI
      .toggleFullScreenWindow()
      .then(setFullScreen)
      .catch(() => undefined);
  }, []);

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserAttachments = (lastUser?.attachments ?? []).map((att) => ({ name: att.name, isImage: att.kind === 'image' }));

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      setDragOver(false);
      if (e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      void handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles]
  );

  return (
    <div
      role="main"
      aria-label={TEXT.LAUNCHER_ROLE_LABEL}
      className="chat-drag-root flex h-screen overflow-hidden rounded-[var(--da-window-radius,24px)] border border-[var(--as-border)] bg-[linear-gradient(160deg,var(--bg-window-start),var(--bg-window-end))] text-[var(--as-fg)]"
      style={{ '--da-window-radius': '24px' } as CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setDragOver(false);
        }
      }}
      onDrop={onDrop}
    >
      {sessionsVisible && (
        <aside aria-label={TEXT.DESKTOP_CONVERSATIONS_LABEL} data-no-drag className="flex w-72 shrink-0 flex-col gap-2 border-r border-[var(--as-border)] p-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold opacity-80">{TEXT.MENU_HISTORY}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={TEXT.LAUNCHER_HISTORY_CLOSE}
              aria-label={TEXT.LAUNCHER_HISTORY_CLOSE}
              onClick={() => applySessionsVisible(false)}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => void newConversation()}>
            <SquarePen className="mr-1 h-3.5 w-3.5" aria-hidden />
            {TEXT.DESKTOP_NEW_CHAT}
          </Button>
          <input
            type="search"
            role="searchbox"
            className="mx-1 rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-xs"
            aria-label={TEXT.SEARCH_MESSAGES}
            placeholder={TEXT.SEARCH_MESSAGES}
            value={messageQuery}
            onChange={(event) => setMessageQuery(event.target.value)}
          />
          {messageQuery.trim().length >= 2 ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {messageError ? (
                <p role="alert" className="px-2 py-1 text-xs" style={{ color: 'var(--as-danger)' }}>
                  {messageError}
                </p>
              ) : messageSearching && messageHits.length === 0 ? (
                <p className="px-2 py-1 text-xs opacity-50">{TEXT.SEARCH_MESSAGES_RUNNING}</p>
              ) : messageHits.length === 0 ? (
                <p className="px-2 py-1 text-xs opacity-50">{TEXT.SEARCH_MESSAGES_EMPTY}</p>
              ) : (
                <ul className="space-y-1">
                  {messageHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--as-secondary)]"
                        onClick={() => {
                          void selectSession(hit.conversationId);
                          setMessageQuery('');
                        }}
                      >
                        <span className="block truncate font-medium">{hit.conversationTitle}</span>
                        <span className="block truncate opacity-60">{hit.snippet}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-1 -m-1">
              <ChatSessionList
                sessions={conversations}
                activeId={activeId}
                onSelect={(id) => void selectSession(id)}
                onNew={() => void newConversation()}
                onRenameCommit={(id, title) => void renameConversation(id, title)}
                onDelete={(id) => setDeletingSession(id)}
                onExport={(id) => void exportConversation(id)}
                searchable={true}
                groupByDate={true}
              />
            </div>
          )}
          <ConversationRailFooter
            disabled={messages.length === 0}
            onClear={() => setConfirmClear(true)}
            onDuplicate={() => void duplicateConversation()}
          />
        </aside>
      )}
      <div
        className="flex min-w-0 flex-1 flex-col"
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("[data-as='chat-panel-header']") || target.closest('button')) {
            return;
          }
          void window.electronAPI.toggleMaximizeWindow();
        }}
      >
        <ChatPanel
          variant="bubble"
          title={<span className="text-sm font-semibold opacity-80">{activeTitle}</span>}
          actions={
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                title={sessionsVisible ? TEXT.LAUNCHER_HISTORY_HIDE : TEXT.LAUNCHER_HISTORY_SHOW}
                aria-label={sessionsVisible ? TEXT.LAUNCHER_HISTORY_HIDE : TEXT.LAUNCHER_HISTORY_SHOW}
                aria-pressed={sessionsVisible}
                onClick={() => applySessionsVisible(!sessionsVisible)}
              >
                <History className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={showInspector ? TEXT.DESKTOP_HIDE_INSPECTOR : TEXT.DESKTOP_SHOW_INSPECTOR}
                onClick={() => applyInspectorVisible(!showInspector)}
              >
                {showInspector ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}
              </Button>
              <Button variant="ghost" size="sm" title={TEXT.LAUNCHER_SETTINGS_TITLE} onClick={() => void window.electronAPI.onSettingsOpen()}>
                <Settings className="h-4 w-4" aria-hidden />
              </Button>
              <ViewSwitcher
                current="desktop"
                onSelect={(view) => {
                  if (view !== 'desktop') {
                    void window.electronAPI.openLauncher(view, manager.getActiveConversation()?.id);
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                title={fullScreen ? TEXT.DESKTOP_EXIT_FULLSCREEN : TEXT.DESKTOP_FULLSCREEN}
                aria-label={fullScreen ? TEXT.DESKTOP_EXIT_FULLSCREEN : TEXT.DESKTOP_FULLSCREEN}
                aria-pressed={fullScreen}
                onClick={toggleFullScreen}
              >
                {fullScreen ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
              </Button>
              <Button variant="ghost" size="sm" title={TEXT.DESKTOP_MINIMIZE} onClick={() => void window.electronAPI.minimizeWindow()}>
                <Minus className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={TEXT.DESKTOP_HIDE_TO_TRAY}
                onClick={() => void window.electronAPI.hideWindow()}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          }
          transcript={
            <div data-no-drag className="contents">
              <ChatTranscript
                autoScroll={config?.behavior?.autoScroll ?? false}
                labels={{ scrollToBottom: TEXT.TRANSCRIPT_SCROLL_LATEST }}
                scrollThresholdPx={SCROLL_STICK_THRESHOLD_PX}
                items={messages}
                renderItem={(message, index) => {
                  const runMeta = (message.meta as unknown as TurnMetadata | undefined)?.miniAppRun;
                  return (
                    <MessageBubble
                      key={message.id ?? index}
                      message={message}
                      compact={true}
                      content={
                        runMeta ? (
                          <MiniAppRunCard
                            run={runMeta}
                            onOpenDetails={(runId, packId) => {
                              void openRunReportWindow(packId, runId).then((opened) => {
                                if (!opened) {
                                  setReportRunId(runId);
                                }
                              });
                            }}
                            className="mt-0.5"
                          />
                        ) : (
                          <MarkdownSurface value={message.content} />
                        )
                      }
                      attachments={message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : undefined}
                      onEdit={editMessage}
                      onRegenerate={regenerateMessage}
                      onSelectVariant={selectVariant}
                    >
                      {message.role === 'assistant' ? (
                        <>
                          {config?.behavior?.traceDetails ? (
                            <TraceTimeline meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                          ) : (
                            <ExpandableTraceMeta meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                          )}
                          {!runMeta && (
                            <ArtifactChips
                              artifacts={(message.meta as unknown as TurnMetadata | undefined)?.artifacts ?? []}
                              className="mt-1"
                            />
                          )}
                          {message.content && (
                          <button
                            type="button"
                            className="mt-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-[11px] opacity-40 transition-opacity hover:opacity-100 disabled:opacity-60"
                            aria-label={TEXT.SPEECH_SPEAK_REPLY}
                            disabled={speechState === 'loading'}
                            onClick={() => void speakText(message.content)}
                          >
                            {speechState === 'loading' ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            ) : (
                              <Volume2 className="h-3 w-3" aria-hidden />
                            )}
                            {TEXT.SPEECH_SPEAK_REPLY}
                          </button>
                        )}
                      </>
                    ) : undefined}
                  </MessageBubble>
                  );
                }}
                live={
                  liveView ? (
                    <ChatMessage role="assistant" content={<StreamedContent value={liveView.content} streaming={true} />} status="streaming" compact={true}>
                      {config?.behavior?.traceDetails ? (
                        <TraceTimeline meta={{ outcome: 'ok', steps: trace.steps }} startedAt={trace.startedAt} className="mt-1" />
                      ) : undefined}
                      <ArtifactChips artifacts={trace.artifacts} className="mt-1" />
                    </ChatMessage>
                  ) : undefined
                }
                emptyState={
                  <div>
                    <OnboardingCard />
                    <div className="p-6 text-center text-sm opacity-50">
                      {TEXT.LAUNCHER_EMPTY_STATE}
                      <SetupEmptyStateCta providers={config?.providers} />
                    </div>
                  </div>
                }
              />
            </div>
          }
          composer={
            <div data-no-drag className="contents">
              <FlowCard
                phase={trace.phase}
                steps={trace.steps}
                error={trace.error}
                onCancel={sending ? () => void window.electronAPI.cancelTurn() : undefined}
                className="da-rise mb-2"
                detail={
                  pendingApproval ? (
                    <ApprovalCard
                      variant="rich"
                      requests={pendingApproval.requests}
                      deadline={pendingApproval.deadline}
                      onResolve={resolveApproval}
                    />
                  ) : activeDownload ? (
                    <DownloadCard
                      variant="rich"
                      progress={activeDownload}
                      onCancel={(id) => void window.electronAPI.cancelDownload(id)}
                    />
                  ) : undefined
                }
              />
              {!hasFlowTimeline(trace.phase, trace.steps) && pendingApproval && (
                <ApprovalCard
                  variant="rich"
                  requests={pendingApproval.requests}
                  deadline={pendingApproval.deadline}
                  onResolve={resolveApproval}
                  className="mb-2"
                />
              )}
              {!hasFlowTimeline(trace.phase, trace.steps) && !pendingApproval && activeDownload && (
                <DownloadCard
                  variant="rich"
                  progress={activeDownload}
                  onCancel={(id) => void window.electronAPI.cancelDownload(id)}
                  className="mb-2"
                />
              )}
              {palette.model && (
                <CommandPalette
                  model={palette.model}
                  pending={session.sending}
                  pinnedIds={palette.pinnedIds}
                  onExecute={palette.execute}
                  onOpenApp={miniApps.enterMiniApp}
                  onTabComplete={(entry) => {
                    const alias = entry.slash ?? entry.aliases[0];
                    if (alias) {
                      session.setInput(`/${alias} `);
                    }
                    session.composerRef.current?.focus();
                  }}
                  onRowAction={(entry, action) => void palette.rowAction(entry, action)}
                  onClose={palette.close}
                />
              )}
              {miniApps.surface}
              <Composer
                value={input}
                onValueChange={setInput}
                onSubmit={() => {
                  if (miniApps.interceptSubmit(input)) {
                    return;
                  }
                  void submit(input);
                }}
                sending={sending}
                onStop={sending ? () => void window.electronAPI.cancelTurn() : undefined}
                attachments={attachments}
                onRemoveAttachment={(index) => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                onAttachFiles={(files) => void handleFiles(files)}
      onCaptureChoice={(choice) => void captureChoice(choice)}
                onOpenAttachment={(index) => void openAttachment(index)}
                onCopyImage={(index) => void copyAttachmentImage(index)}
                onReadText={(index) => void readAttachmentText(index)}
      captureText={
        captureText
          ? {
              state: captureText,
              busy: captureTextBusy,
              onAction: (action, text) => void runCaptureTextAction(action, text),
              onClose: dismissCaptureText,
            }
          : null
      }
                onToggleRecording={() => void toggleRecording()}
                onCancelRecording={cancelRecording}
                onClearInterim={clearInterim}
                voiceState={voiceState}
                voiceLevel={voiceLevel}
                voiceInterim={voiceInterim}
                voiceAvailable={voiceAvailable}
                speechState={speechState}
                speechProgress={speechProgress}
                onPauseSpeaking={toggleSpeechPause}
                onStopSpeaking={stopSpeaking}
                liveActive={liveActive}
                liveState={liveSnapshot?.state}
                liveFullDuplex={liveFullDuplex}
                liveIgnoredHint={liveIgnoredHint}
                voiceInterimSent={voiceInterimSent}
                onToggleLive={() => (liveActive ? stopLive() : void startLive())}
                onToggleDuplex={() => setLiveFullDuplex(!liveFullDuplex)}
                onInsertSelection={insertSelection ?? undefined}
                selection={selection}
                onSpeakSelection={speakSelection}
                textareaRef={composerRef}
              />
            </div>
          }
        />
      </div>
      {showInspector && (
        <aside aria-label={TEXT.DESKTOP_INSPECTOR_LABEL} className="w-80 shrink-0" data-no-drag>
          <Inspector
            live={live.live}
            liveTrace={{ phase: trace.phase, startedAt: trace.startedAt, steps: trace.steps }}
            lastAssistant={lastAssistant}
            lastUserAttachments={lastUserAttachments}
            activeModel={activeModel}
            activeModelLabel={activeModelLabel}
            savedModelId={metadata?.modelId ?? null}
            modelProviders={pickerProviders}
            onModelChange={(modelId) => void setConversationModel(modelId)}
            onClose={() => applyInspectorVisible(false)}
            persona={manager.getActiveConversation()?.metadata?.systemPrompt}
            personaKey={activeId ?? undefined}
            onPersonaChange={(persona) => void setConversationPersona(persona)}
            speak={manager.getActiveConversation()?.metadata?.speakReplies}
            onSpeakChange={(speak) => void setConversationSpeak(speak)}
            onExport={(format) => void exportConversation(undefined, format)}
            catalog={catalog}
            branchTree={branchTree}
            onSelectBranch={(id) => void selectVariant(id)}
          />
        </aside>
      )}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="rounded-xl border-2 border-dashed border-[var(--as-primary)] px-6 py-4 text-sm">
            {TEXT.DESKTOP_DROP_FILES}
          </div>
        </div>
      )}
      <ConfirmationModal
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={TEXT.CONFIRM_CLEAR_TITLE}
        description={TEXT.CONFIRM_CLEAR_DESCRIPTION}
        confirmLabel={TEXT.CLEAR_BUTTON}
        destructive
        onConfirm={() => void clearConversation()}
      />
      <ConfirmationModal
        open={deletingSession !== null}
        onOpenChange={(open) => { if (!open) { setDeletingSession(null); } }}
        title={TEXT.CONFIRM_DELETE_TITLE}
        description={TEXT.CONFIRM_DELETE_DESCRIPTION}
        confirmLabel={TEXT.DELETE_BUTTON}
        destructive
        onConfirm={() => { if (deletingSession) { void deleteSession(deletingSession); } }}
      />
      {reportRunId && <RunReportModal runId={reportRunId} onClose={() => setReportRunId(null)} />}
    </div>
  );
}
