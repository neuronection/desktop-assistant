import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ChatPanel } from '@neuronection/assistant-ui/chat-panel';
import { ChatSessionList } from '@neuronection/assistant-ui/chat-session-list';
import { ChatTranscript } from '@neuronection/assistant-ui/chat-transcript';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { TriangleAlert, X, Ellipsis, Heart, Loader2, PanelLeftClose, PanelLeftOpen, Settings, Volume2 } from 'lucide-react';import { ThemeType } from '@shared/constants/themes';
import { DesktopModeIcon, ExpandedModeIcon, LauncherModeIcon } from '@renderer/shared/modeIcons';
import { FundCard } from './FundCard';
import { WINDOW_SIZE, getWindowSize } from '@shared/constants/window';
import { TEXT } from '@shared/constants/text';
import { WindowState } from '@shared/types';
import { initialLauncherState, launcherReducer } from './launcherState';
import { SCROLL_STICK_THRESHOLD_PX, compactWindowHeight, desiredResponsePanelHeight, isScrolledToBottom } from './launcherLayout';
import { TraceStrip } from './TraceStrip';
import { ApprovalCard } from './ApprovalCard';
import { DownloadCard, findActiveDownload } from './DownloadCard';
import { ArtifactChips } from './ArtifactChips';
import { SetupEmptyStateCta } from './SetupEmptyStateCta';
import { useWindowSelection } from './useWindowSelection';
import { NoticeBanner } from './NoticeBanner';
import { LauncherMenu } from './LauncherMenu';
import { Composer } from './Composer';
import { MessageAttachments } from './MessageAttachments';
import { ScreenPicker } from './ScreenPicker';
import { useChatSession } from './useChatSession';
import { usePushToTalk } from './usePushToTalk';
import { CommandPalette } from './CommandPalette';
import { formatSlashEntry } from './commandSource';
import { useCommandPalette } from './useCommandPalette';
import { miniAppForEntry } from './miniApps';
import { useMiniApps } from './useMiniApps';
import type { CommandEntry } from '@shared/commands';
import { useClipboardOffer } from './useClipboardOffer';
import { useWindowHeaderDrag } from './useWindowHeaderDrag';
import { TraceTimeline, TraceMetaRow } from './TraceTimeline';
import type { TurnMetadata } from '@shared/turns';
import { ResizeHandle } from './ResizeHandle';
import { isDialogOpen } from './dialogGuard';
import { NOTICE_ACTION_TIMEOUT_MS, NOTICE_EVENT, NOTICE_TIMEOUT_MS, nextNotice, noticeActionFor, toNoticeEvent, type NoticeState } from './notice';
import { hasConfiguredProvider } from '@shared/ai/providerPresets';
interface ChatAppProps {
  onThemeChange: (theme: ThemeType) => void;
}

export function ChatApp(_props: ChatAppProps): JSX.Element {
  const [launcher, dispatch] = useReducer(launcherReducer, initialLauncherState);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const panelContentRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const panelStickRef = useRef<boolean>(true);
  const panelHRef = useRef<number>(WINDOW_SIZE.LAUNCHER_RESPONSE_BASE_HEIGHT);
  const autoExpandedRef = useRef(false);
  const [panelH, setPanelH] = useState<number>(WINDOW_SIZE.LAUNCHER_RESPONSE_BASE_HEIGHT);
  const [chromeH, setChromeH] = useState<number>(0);
  const chromeHRef = useRef<number>(0);
  const [panelClamped, setPanelClamped] = useState<boolean>(false);
  const panelClampedRef = useRef<boolean>(false);
  const [manualResize, setManualResize] = useState<boolean>(false);
  const manualResizeRef = useRef<boolean>(false);

  const exitManualResize = useCallback((): void => {
    if (manualResizeRef.current) {
      manualResizeRef.current = false;
      setManualResize(false);
    }
  }, []);

  const enterManualResize = useCallback((): void => {
    manualResizeRef.current = true;
    setManualResize(true);
  }, []);

  const launcherUiRef = useRef(launcher.ui);
  launcherUiRef.current = launcher.ui;

  const session = useChatSession({
    onSessionChanged: () => {
      exitManualResize();
      // Expanded mode is a full-size surface — new/select/clear happen in
      // place instead of collapsing the window back to the compact bar.
      if (launcherUiRef.current !== 'expanded') {
        dispatch({ type: 'dismiss' });
        setHistoryVisible(false);
        setShowSessions(false);
      }
    },
    onAutoSendSubmit: () => {
      if (launcherUiRef.current !== 'expanded') {
        dispatch({ type: 'send' });
      }
    },
    onTurnSubmitting: () => {
      exitManualResize();
      if (launcherUiRef.current !== 'expanded') {
        dispatch({ type: 'send' });
      }
    },
    onMiniAppRequest: (entry, openOptions) => miniApps.enterMiniApp(entry, openOptions),
    isMiniAppActive: () => miniApps.isMiniAppActive(),
    onMiniAppExit: () => miniApps.exitMiniApp(),
    miniContext: () => miniApps.miniContext(),
  });
  const {
    manager,
    conversations,
    activeId,
    config,
    messages,
    attachments,
    setAttachments,
    input,
    setInput,
    voiceState,
    voiceLevel,
    voiceInterim,
    voiceAvailable,
    insertSelection,
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
    toggleRecording,
    startPushToTalk,
    stopPushToTalk,
    cancelRecording,
    clearInterim,
    speechState,
    stopSpeaking,
    speakText,
    handleFiles,
    captureScreen,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
    pendingApproval,
    resolveApproval,
  } = session;
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const activeDownload = useMemo(() => findActiveDownload(trace.steps), [trace]);
  const selection = useWindowSelection(true);
  const speakSelection = (text: string): void => {
    window.getSelection()?.removeAllRanges();
    void speakText(text);
  };
  const miniApps = useMiniApps({ input, setInput, composerRef, config });
  const onHeaderPointerDown = useWindowHeaderDrag();

  usePushToTalk({
    enabled: voiceAvailable,
    onStart: () => startPushToTalk(),
    onStop: () => void stopPushToTalk(),
  });

  const palette = useCommandPalette({
    input,
    setInput,
    composerRef,
    executeEntry: session.runCommandEntry,
    sending,
    enabled: !pickerOpen,
    allowedIds: miniApps.paletteAllowedIds,
    extraEntries: miniApps.miniExitEntries,
  });
  const { model: paletteModel } = palette;

  const openActiveInDesktop = useCallback((): void => {
    void window.electronAPI.openDesktop(manager.getActiveConversation()?.id ?? undefined);
  }, [manager]);

  const openConversationExpanded = useCallback(
    async (id: string): Promise<void> => {
      await selectSession(id);
      if (launcherUiRef.current !== 'expanded') {
        dispatch({ type: 'toggle_expand' });
      }
    },
    [selectSession]
  );

  const openConversationDesktop = useCallback((id: string): void => {
    void window.electronAPI.openDesktop(id);
  }, []);

  const liveStatus = live.live?.status ?? null;
  useEffect(() => {
    if (liveStatus === 'streaming') {
      dispatch({ type: 'first_delta' });
    } else if (liveStatus === 'done' || liveStatus === 'interrupted') {
      dispatch({ type: 'turn_finished' });
    } else if (liveStatus === 'error') {
      dispatch({ type: 'turn_failed' });
    }
  }, [liveStatus]);

  const goIdle = useCallback((): void => {
    exitManualResize();
    dispatch({ type: 'dismiss' });
    traceStore.reset();
    live.reset();
  }, [live, traceStore]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        dispatch({ type: 'window_hidden' });
        setMenuOpen(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherToggleExpand?.(() => dispatch({ type: 'toggle_expand' }));
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherNewConversation?.(() => {
      void newConversation();
    });
    return () => unsubscribe?.();
  }, [newConversation]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionSync?.((conversationId) => {
      void selectSession(conversationId);
    });
    return () => unsubscribe?.();
  }, [selectSession]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherSetMode?.((mode) => {
      dispatch({ type: mode === 'expanded' ? 'auto_expand' : 'collapse' });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherOpenPalette?.(() => {
      palette.requestOpen();
    });
    return () => unsubscribe?.();
  }, [palette]);

  useEffect(() => {
    const onNotice = (event: Event): void => {
      const noticeEvent = toNoticeEvent((event as CustomEvent).detail);
      if (!noticeEvent) {
        return;
      }
      setNotice((current) => nextNotice(current, noticeEvent));
    };
    window.addEventListener(NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(NOTICE_EVENT, onNotice);
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const actionable = noticeActionFor(notice.message, hasConfiguredProvider(config?.providers)) !== null;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, actionable ? NOTICE_ACTION_TIMEOUT_MS : NOTICE_TIMEOUT_MS[notice.type]);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    // Dev keeps the launcher up when focus moves to DevTools — the
    // click-away hide makes renderer debugging impossible otherwise.
    if (process.env.NODE_ENV === 'development') {
      return undefined;
    }
    // Opt-in (Settings → General): the launcher never hides on blur
    // unless hide-on-blur is enabled.
    if (!config?.behavior?.hideOnBlur) {
      return undefined;
    }
    const onHide = (): void => {
      if (voiceState !== 'idle' || pickerOpen || confirmClear || deletingSession !== null || isDialogOpen()) {
        return;
      }
      window.setTimeout(() => {
        if (!document.hasFocus() && !isDialogOpen()) {
          window.electronAPI.hideWindow();
        }
      }, 150);
    };
    window.addEventListener('blur', onHide);
    return () => window.removeEventListener('blur', onHide);
  }, [config?.behavior?.hideOnBlur, voiceState, pickerOpen, confirmClear, deletingSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (miniApps.miniApp) {
          miniApps.exitMiniApp();
          return;
        }
        dispatch({ type: 'toggle_expand' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        openActiveInDesktop();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette.requestOpen();
        return;
      }
      if (e.key === 'Escape' && miniApps.miniApp) {
        e.preventDefault();
        miniApps.exitMiniApp();
        return;
      }
      if (e.key === 'Escape' && voiceState === 'idle') {
        if (launcher.ui === 'expanded') {
          dispatch({ type: 'collapse' });
          setHistoryVisible(false);
          setShowSessions(false);
        } else {
          window.electronAPI.hideWindow();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [launcher.ui, openActiveInDesktop, voiceState, miniApps]);

  useEffect(() => {
    if (launcher.ui !== 'responding' && launcher.ui !== 'done') {
      return;
    }
    if (launcher.ui === 'responding') {
      panelStickRef.current = true;
    }
    panelClampedRef.current = false;
    setPanelClamped(false);
    const maxPanel = Math.round(window.screen.availHeight * WINDOW_SIZE.LAUNCHER_RESPONSE_MAX_RATIO);
    const observer = new ResizeObserver(() => {
      const content = panelContentRef.current;
      if (content) {
        const desired = desiredResponsePanelHeight(content.scrollHeight, maxPanel);
        const clamped = desired >= maxPanel - 4;
        if (clamped !== panelClampedRef.current) {
          panelClampedRef.current = clamped;
          setPanelClamped(clamped);
        }
        if (clamped && !autoExpandedRef.current && launcher.ui === 'responding') {
          if (config?.behavior?.autoExpand ?? true) {
            autoExpandedRef.current = true;
            dispatch({ type: 'auto_expand' });
          }
        }
        if (Math.abs(desired - panelHRef.current) >= 2) {
          panelHRef.current = desired;
          setPanelH(desired);
        }
      }
    });
    if (panelContentRef.current) {
      observer.observe(panelContentRef.current);
    }
    return () => observer.disconnect();
  }, [launcher.ui, config]);

  useEffect(() => {
    if (launcher.ui === 'expanded') {
      return;
    }
    const chrome = chromeRef.current;
    if (!chrome) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const next = chrome.offsetHeight;
      if (next > 0 && Math.abs(next - chromeHRef.current) >= 2) {
        chromeHRef.current = next;
        setChromeH(next);
      }
    });
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [launcher.ui]);

  useEffect(() => {
    if (launcher.ui === 'expanded' && !pickerOpen) {
      const size = getWindowSize(WindowState.EXPANDED, null, historyVisible);
      void window.electronAPI.resizeWindow(size.width, size.height);
      return;
    }
    if (pickerOpen) {
      void window.electronAPI.resizeWindow(WINDOW_SIZE.COMPACT_WIDTH, WINDOW_SIZE.SCREEN_SOURCE_PICKER_HEIGHT);
      return;
    }
    // A manual corner drag owns the window until the next turn, dismiss or
    // session change — otherwise every streaming delta snaps the user's
    // size back to the content-fit budget.
    if (manualResize) {
      return;
    }
    void window.electronAPI.resizeWindow(WINDOW_SIZE.COMPACT_WIDTH, Math.max(compactWindowHeight(launcher.ui, chromeH, panelH), WINDOW_SIZE.MIN_HEIGHT));
  }, [launcher.ui, historyVisible, chromeH, panelH, pickerOpen, manualResize]);

  const responseContent =
    launcher.ui === 'responding' ? live.live?.text ?? '' : launcher.ui === 'done' ? lastAssistant?.content ?? '' : '';

  useEffect(() => {
    const el = panelScrollRef.current;
    if (el && panelStickRef.current && (config?.behavior?.autoScroll ?? false)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [responseContent, config]);

  const launcherToolbar = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-35 transition-opacity hover:opacity-100 hover:text-rose-400"
        title={TEXT.LAUNCHER_SUPPORT_TITLE}
        aria-label={TEXT.LAUNCHER_SUPPORT_TITLE}
        onClick={() => setFundOpen(true)}
      >
        <Heart className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={TEXT.LAUNCHER_MORE_BUTTON}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </>
  );

  const insertContext = useCallback(
    (text: string): void => {
      setInput((prev) => (prev ? `${prev}\n${text}` : text));
      composerRef.current?.focus();
    },
    [setInput, composerRef]
  );
  const clipboardOffer = useClipboardOffer();

  const submitFromComposer = useCallback((): void => {
    if (miniApps.interceptSubmit(input)) {
      return;
    }
    if (!input.trim() && attachments.length === 0) {
      return;
    }
    exitManualResize();
    void submit(input);
  }, [input, attachments.length, submit, exitManualResize, miniApps]);

  const executeCommandEntry = useCallback(
    (entry: CommandEntry, argv: string[]): void => {
      void submit(formatSlashEntry(entry, argv));
    },
    [submit]
  );

  const composer = (
    <Composer
      value={input}
      onValueChange={setInput}
      onSubmit={submitFromComposer}
      sending={sending}
      onStop={sending ? () => void window.electronAPI.cancelTurn() : undefined}
      attachments={attachments}
      onRemoveAttachment={(index) => setAttachments((prev) => prev.filter((_, i) => i !== index))}
      onAttachFiles={(files) => void handleFiles(files)}
      onPickScreen={() => setPickerOpen(true)}
      onToggleRecording={() => void toggleRecording()}
      onCancelRecording={cancelRecording}
      onClearInterim={clearInterim}
      voiceState={voiceState}
      voiceLevel={voiceLevel}
      voiceInterim={voiceInterim}
      voiceAvailable={voiceAvailable}
      speechState={speechState}
      onStopSpeaking={stopSpeaking}
      onInsertSelection={insertSelection ?? undefined}
      selection={selection}
      onSpeakSelection={speakSelection}
      clipboardOffer={clipboardOffer}
      onInsertClipboard={insertContext}
      textareaRef={composerRef}
      placeholder={miniApps.miniApp?.placeholder}
      toolbarEnd={launcher.ui === 'expanded' ? undefined : launcherToolbar}
    />
  );

  const paletteNode = paletteModel ? (
    <CommandPalette
      model={paletteModel}
      pending={sending}
      pinnedIds={palette.pinnedIds}
      argDefaults={config?.commands?.argDefaults}
      onExecute={(entry, argv) => {
        const mini = miniAppForEntry(entry);
        if (mini && argv.length === 0) {
          miniApps.enterMiniApp(entry);
          return;
        }
        executeCommandEntry(entry, argv);
      }}
      onOpenApp={miniApps.enterMiniApp}
      onRowAction={(entry, action) => void palette.rowAction(entry, action)}
      onTabComplete={(entry) => {
        const alias = entry.slash ?? entry.aliases[0];
        if (alias) {
          setInput(`/${alias} `);
        }
        composerRef.current?.focus();
      }}
      onClose={palette.close}
    />
  ) : null;

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const noticeAction = notice ? noticeActionFor(notice.message, hasConfiguredProvider(config?.providers)) : null;
  const noticeBanner = notice ? (
    <NoticeBanner
      notice={notice}
      onDismiss={dismissNotice}
      action={
        noticeAction
          ? {
              label: noticeAction.label,
              onActivate: () => {
                dismissNotice();
                void window.electronAPI.onSettingsOpen({
                  tab: 'api',
                  section: noticeAction.target === 'tasks' ? 'tasks' : 'providers',
                });
              },
            }
          : undefined
      }
      className="mb-0.5"
    />
  ) : null;

  return (
    <div
      role="main"
      aria-label={TEXT.LAUNCHER_ROLE_LABEL}
      className="chat-drag-root relative flex h-screen overflow-hidden rounded-[var(--da-window-radius,24px)] border border-[var(--as-border)] bg-[linear-gradient(160deg,var(--bg-window-start),var(--bg-window-end))] text-[var(--as-fg)]"
    >
      {launcher.ui === 'expanded' ? (
        <>
          {historyVisible && showSessions && (
            <aside data-no-drag className="w-64 shrink-0 border-r border-[var(--as-border)] p-2">
              <ChatSessionList
                sessions={conversations}
                activeId={activeId}
                onSelect={(id) => void selectSession(id)}
                onNew={() => void newConversation()}
                onDelete={(id) => setDeletingSession(id)}
                searchable={true}
                groupByDate={false}
              />
            </aside>
          )}
          <div className="min-w-0 flex-1" onPointerDown={onHeaderPointerDown}>
            <ChatPanel
              variant="bubble"
              title={<span className="text-sm font-semibold opacity-80">{TEXT.LAUNCHER_CONVERSATION_TITLE}</span>}
              actions={
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={historyVisible ? TEXT.LAUNCHER_HISTORY_HIDE : TEXT.LAUNCHER_HISTORY_SHOW}
                    aria-label={historyVisible ? TEXT.LAUNCHER_HISTORY_HIDE : TEXT.LAUNCHER_HISTORY_SHOW}
                    aria-pressed={historyVisible}
                    onClick={() => {
                      const next = !historyVisible;
                      setHistoryVisible(next);
                      setShowSessions(next);
                    }}
                  >
                    {historyVisible ? <PanelLeftClose className="h-4 w-4" aria-hidden /> : <PanelLeftOpen className="h-4 w-4" aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void newConversation()}>{TEXT.LAUNCHER_NEW_BUTTON}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>{TEXT.CLEAR_BUTTON}</Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={TEXT.LAUNCHER_OPEN_DESKTOP}
                    aria-label={TEXT.LAUNCHER_OPEN_DESKTOP}
                    onClick={openActiveInDesktop}
                  >
                    <DesktopModeIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={TEXT.LAUNCHER_COMPACT_MODE}
                    aria-label={TEXT.LAUNCHER_COMPACT_MODE}
                    onClick={() => dispatch({ type: 'collapse' })}
                  >
                    <LauncherModeIcon className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" title={TEXT.LAUNCHER_SETTINGS_TITLE} aria-label={TEXT.LAUNCHER_SETTINGS_TITLE} onClick={() => void window.electronAPI.onSettingsOpen()}>
                    <Settings className="h-4 w-4" aria-hidden />
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
                    renderItem={(message, index) => (
                      <ChatMessage
                        key={message.id ?? index}
                        role={message.role}
                        content={<MarkdownSurface value={message.content} />}
                        status={message.status}
                        compact={true}
                        attachments={message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : undefined}
                      >
                        {message.role === 'assistant' ? (
                          <>
                            {config?.behavior?.traceDetails ? (
                              <TraceTimeline meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                            ) : (
                              <TraceMetaRow meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                            )}
                            <ArtifactChips
                              artifacts={(message.meta as unknown as TurnMetadata | undefined)?.artifacts ?? []}
                              className="mt-1"
                            />
                          </>
                        ) : undefined}
                      </ChatMessage>
                    )}
                    live={
                      liveView ? (
                        <ChatMessage role="assistant" content={<MarkdownSurface value={liveView.content} streaming={true} />} status="streaming" compact={true}>
                          {config?.behavior?.traceDetails ? (
                            <TraceTimeline meta={{ outcome: 'ok', steps: trace.steps }} startedAt={trace.startedAt} className="mt-1" />
                          ) : undefined}
                          <ArtifactChips artifacts={trace.artifacts} className="mt-1" />
                        </ChatMessage>
                      ) : undefined
                    }
                    emptyState={
                      <div className="p-6 text-center text-sm opacity-50">
                        {TEXT.LAUNCHER_EMPTY_STATE}
                        <SetupEmptyStateCta providers={config?.providers} />
                      </div>
                    }
                  />
                </div>
              }
              composer={
                <div data-no-drag className="contents">
                  {noticeBanner}
                  {pendingApproval && (
                    <ApprovalCard
                      variant="rich"
                      requests={pendingApproval.requests}
                      deadline={pendingApproval.deadline}
                      onResolve={resolveApproval}
                      className="mb-2"
                    />
                  )}
                  {!pendingApproval && activeDownload && (
                    <DownloadCard
                      variant="rich"
                      progress={activeDownload}
                      onCancel={(id) => void window.electronAPI.cancelDownload(id)}
                      className="mb-2"
                    />
                  )}
                  {paletteNode}
                  {miniApps.surface}
                  {composer}
                </div>
              }
            />
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col justify-end">
          {(launcher.ui === 'responding' || launcher.ui === 'done') && (
            <div data-no-drag className="da-rise relative mx-3 mt-2 mb-2 min-h-0 flex-1">
              <div className="absolute right-2 top-1.5 z-10 flex items-center gap-0.5 opacity-40 transition-opacity hover:opacity-100">
                {launcher.ui === 'done' && lastAssistant?.content && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={speechState === 'loading'}
                    title={TEXT.SPEECH_SPEAK_REPLY}
                    aria-label={TEXT.SPEECH_SPEAK_REPLY}
                    onClick={() => void speakText(lastAssistant.content)}
                  >
                    {speechState === 'loading' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title={TEXT.LAUNCHER_OPEN_DESKTOP}
                  aria-label={TEXT.LAUNCHER_OPEN_DESKTOP}
                  onClick={openActiveInDesktop}
                >
                  <DesktopModeIcon className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title={TEXT.MENU_EXPAND}
                  aria-label={TEXT.MENU_EXPAND}
                  onClick={() => dispatch({ type: 'toggle_expand' })}
                >
                  <ExpandedModeIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div
                ref={panelScrollRef}
                onWheel={(e) => {
                  if (e.deltaY < 0) {
                    panelStickRef.current = false;
                  }
                }}
                onScroll={() => {
                  const el = panelScrollRef.current;
                  if (el) {
                    panelStickRef.current = isScrolledToBottom(el);
                  }
                }}
                className={`h-full overflow-y-auto rounded-2xl border border-[var(--as-border)] bg-[var(--as-surface)]/60 px-3 py-2 text-sm ${panelClamped ? '' : 'no-scrollbar'}`}
              >
                <div ref={panelContentRef}>
                  <MarkdownSurface value={responseContent} streaming={launcher.ui === 'responding'} />
                </div>
              </div>
            </div>
          )}
          <div ref={chromeRef} className="flex flex-col gap-1.5 px-3 pb-3 pt-1">
            {noticeBanner}
            {pendingApproval && (
              <ApprovalCard
                variant="compact"
                requests={pendingApproval.requests}
                deadline={pendingApproval.deadline}
                onResolve={resolveApproval}
              />
            )}
            {!pendingApproval && activeDownload && (
              <DownloadCard
                variant="compact"
                progress={activeDownload}
                onCancel={(id) => void window.electronAPI.cancelDownload(id)}
              />
            )}
            {launcher.ui === 'done' && lastMeta && (
              <div className="da-rise px-1">
                {config?.behavior?.traceDetails ? (
                  <TraceTimeline meta={lastMeta} />
                ) : (
                  <TraceMetaRow meta={lastMeta} />
                )}
                <ArtifactChips artifacts={trace.artifacts} className="mt-1" />
              </div>
            )}
            {launcher.ui === 'failed' && (
              <div
                className="da-rise flex items-start gap-2 rounded-xl border border-[var(--as-danger)]/40 bg-[var(--as-danger)]/10 px-3 py-2 text-xs"
                role="alert"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 break-words">{live.live?.error?.message ?? TEXT.LAUNCHER_TURN_FAILED}</span>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={goIdle} aria-label={TEXT.LAUNCHER_DISMISS_ERROR}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
            {(launcher.ui === 'thinking' || launcher.ui === 'responding') && (
              <TraceStrip phase={trace.phase} startedAt={trace.startedAt} steps={trace.steps} className="da-rise" />
            )}
            {menuOpen && (
              <LauncherMenu
                conversations={conversations}
                activeId={activeId}
                onToggleExpand={() => {
                  setMenuOpen(false);
                  dispatch({ type: 'toggle_expand' });
                }}
                onOpenDesktop={() => {
                  setMenuOpen(false);
                  openActiveInDesktop();
                }}
                onNewConversation={() => {
                  setMenuOpen(false);
                  void newConversation();
                }}
                onOpenSettings={() => {
                  setMenuOpen(false);
                  void window.electronAPI.onSettingsOpen();
                  void window.electronAPI.hideWindow();
                }}
                onOpenAbout={() => {
                  setMenuOpen(false);
                  void window.electronAPI.onSettingsOpen({ tab: 'about' });
                  void window.electronAPI.hideWindow();
                }}
                onOpenConversation={(id) => {
                  setMenuOpen(false);
                  void openConversationExpanded(id);
                }}
                onOpenConversationDesktop={openConversationDesktop}
                onClose={() => setMenuOpen(false)}
              />
            )}
            {fundOpen && <FundCard onClose={() => setFundOpen(false)} />}
            {paletteNode}
            {miniApps.surface}
            {composer}
          </div>
        </div>
      )}
      {pickerOpen && (
        <ScreenPicker
          onClose={() => {
            setPickerOpen(false);
            composerRef.current?.focus();
          }}
          onSelect={(id) => {
            void captureScreen(id);
            composerRef.current?.focus();
          }}
        />
      )}
      {!pickerOpen && <ResizeHandle corner="bottom-right" onResizeStart={enterManualResize} />}
      {!pickerOpen && <ResizeHandle corner="bottom-left" onResizeStart={enterManualResize} />}
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
    </div>
  );
}
