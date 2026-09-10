import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ChatPanel } from '@neuronection/assistant-ui/chat-panel';
import { ChatSessionList } from '@neuronection/assistant-ui/chat-session-list';
import { ChatTranscript } from '@neuronection/assistant-ui/chat-transcript';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import { ChatTraceMeta } from '@neuronection/assistant-ui/chat-trace-meta';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { Check, Copy, Monitor, TriangleAlert, X, Ellipsis, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';import { ThemeType } from '@shared/constants/themes';
import { WINDOW_SIZE, getWindowSize } from '@shared/constants/window';
import { TEXT, interpolate } from '@shared/constants/text';
import { WindowState } from '@shared/types';
import { initialLauncherState, launcherReducer } from './launcherState';
import { SCROLL_STICK_THRESHOLD_PX, compactWindowHeight, desiredResponsePanelHeight, isScrolledToBottom } from './launcherLayout';
import { TraceStrip } from './TraceStrip';
import { ApprovalCard } from './ApprovalCard';
import { NoticeBanner } from './NoticeBanner';
import { LauncherMenu } from './LauncherMenu';
import { Composer } from './Composer';
import { MessageAttachments } from './MessageAttachments';
import { ScreenPicker } from './ScreenPicker';
import { useChatSession } from './useChatSession';
import { CommandPalette } from './CommandPalette';
import { formatSlashEntry } from './commandSource';
import { useCommandPalette } from './useCommandPalette';
import { miniAppForEntry, MiniAppIcon, type MiniApp } from './miniApps';
import { evaluateExpression, formatCalcResult } from '@shared/commands';
import type { CommandEntry } from '@shared/commands';
import { ContextChips } from './ContextChips';
import { useWindowHeaderDrag } from './useWindowHeaderDrag';
import { TraceTimeline } from './TraceTimeline';
import type { TurnMetadata } from '@shared/turns';
import { ResizeHandle } from './ResizeHandle';
import { isDialogOpen } from './dialogGuard';
import { NOTICE_EVENT, NOTICE_TIMEOUT_MS, nextNotice, toNoticeEvent, type NoticeState } from './notice';
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
    onMiniAppRequest: (entry) => enterMiniApp(entry),
    isMiniAppActive: () => miniApp !== null,
    onMiniAppExit: () => exitMiniApp(),
    miniContext: () =>
      miniApp ? { active: true, allowedIds: [miniApp.id, 'nav:quit'], appName: miniApp.title } : null,
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
    cancelRecording,
    clearInterim,
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
  const [commandHintDismissed, setCommandHintDismissed] = useState(false);
  const [miniApp, setMiniApp] = useState<MiniApp | null>(null);
  const [miniCopied, setMiniCopied] = useState(false);
  const [miniRowHover, setMiniRowHover] = useState(false);
  useEffect(() => {
    if (!miniCopied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setMiniCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [miniCopied]);
  const onHeaderPointerDown = useWindowHeaderDrag();

  const exitMiniApp = useCallback((): void => {
    setMiniApp(null);
    setMiniCopied(false);
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const enterMiniApp = useCallback((entry: CommandEntry): void => {
    setCommandHintDismissed(true);
    setMiniCopied(false);
    setMiniApp(miniAppForEntry(entry));
    setInput('');
    composerRef.current?.focus();
  }, [setInput, composerRef]);

  const miniExitEntries = useMemo(
    () =>
      miniApp
        ? [
            {
              id: 'nav:quit',
              kind: 'builtin' as const,
              title: interpolate(TEXT.COMMAND_MINI_EXIT_TITLE, { app: miniApp.title }),
              subtitle: miniApp.hint,
              category: 'navigation' as const,
              icon: 'log-out',
              aliases: ['exit', 'quit'],
              slash: 'exit',
              source: 'system' as const,
              scopes: { palette: true, agent: false },
              args: [],
              action: 'nav:quit' as const,
            },
          ]
        : [],
    [miniApp]
  );

  const palette = useCommandPalette({
    input,
    setInput,
    composerRef,
    executeEntry: session.runCommandEntry,
    sending,
    enabled: launcher.ui !== 'expanded' && !pickerOpen,
    allowedIds: miniApp ? [miniApp.id, 'nav:quit'] : undefined,
    extraEntries: miniExitEntries,
  });
  const { open: paletteOpen, model: paletteModel } = palette;

  const openActiveInDesktop = useCallback((): void => {
    void window.electronAPI.openDesktop(manager.getActiveConversation()?.id ?? undefined);
  }, [manager]);

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
    const unsubscribe = window.electronAPI.onLauncherOpenPalette?.(() => {
      setCommandHintDismissed(true);
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
    const timer = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, NOTICE_TIMEOUT_MS[notice.type]);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    // Dev keeps the launcher up when focus moves to DevTools — the
    // click-away hide makes renderer debugging impossible otherwise.
    if (process.env.NODE_ENV === 'development') {
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
  }, [voiceState, pickerOpen, confirmClear, deletingSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (miniApp) {
          exitMiniApp();
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
      if (e.key === 'Escape' && miniApp) {
        e.preventDefault();
        exitMiniApp();
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
  }, [launcher.ui, openActiveInDesktop, voiceState, miniApp, exitMiniApp]);

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
    if (el && panelStickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [responseContent]);

  const launcherToolbar = (
    <>
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

  const copyMiniResult = useCallback((): void => {
    if (miniApp?.id !== 'calc:evaluate') {
      return;
    }
    const result = evaluateExpression(input.trim());
    if (result.ok) {
      setMiniCopied(true);
      void window.electronAPI.writeToClipboard(formatCalcResult(result.value)).catch(() => undefined);
    }
  }, [miniApp, input]);

  const submitFromComposer = useCallback((): void => {
    if (miniApp && launcher.ui !== 'expanded' && !input.trimStart().startsWith('/')) {
      copyMiniResult();
      return;
    }
    if (!input.trim() && attachments.length === 0) {
      return;
    }
    exitManualResize();
    void submit(input);
  }, [input, attachments.length, submit, exitManualResize, miniApp, launcher.ui, copyMiniResult]);

  const executeCommandEntry = useCallback(
    (entry: CommandEntry, argv: string[]): void => {
      setCommandHintDismissed(true);
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
      onInsertSelection={insertSelection ?? undefined}
      textareaRef={composerRef}
      placeholder={miniApp && launcher.ui !== 'expanded' ? miniApp.placeholder : undefined}
      toolbarEnd={launcher.ui === 'expanded' ? undefined : launcherToolbar}
    />
  );

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const noticeBanner = notice ? <NoticeBanner notice={notice} onDismiss={dismissNotice} className="mb-0.5" /> : null;

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
                    <Monitor className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={TEXT.LAUNCHER_COMPACT_MODE}
                    aria-label={TEXT.LAUNCHER_COMPACT_MODE}
                    onClick={() => dispatch({ type: 'collapse' })}
                  >
                    <Minimize2 className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" title={TEXT.LAUNCHER_SETTINGS_TITLE} aria-label={TEXT.LAUNCHER_SETTINGS_TITLE} onClick={() => void window.electronAPI.onSettingsOpen()}>
                    <Settings className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              }
              transcript={
                <div data-no-drag className="contents">
                  <ChatTranscript
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
                        {config?.behavior?.traceDetails && message.role === 'assistant' ? (
                          <TraceTimeline meta={message.meta as unknown as TurnMetadata} className="mt-1" />
                        ) : undefined}
                      </ChatMessage>
                    )}
                    live={
                      liveView ? (
                        <ChatMessage role="assistant" content={<MarkdownSurface value={liveView.content} streaming={true} />} status="streaming" compact={true}>
                          {config?.behavior?.traceDetails ? (
                            <TraceTimeline meta={{ outcome: 'ok', steps: trace.steps }} startedAt={trace.startedAt} className="mt-1" />
                          ) : undefined}
                        </ChatMessage>
                      ) : undefined
                    }
                    emptyState={<div className="p-6 text-center text-sm opacity-50">{TEXT.LAUNCHER_EMPTY_STATE}</div>}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title={TEXT.LAUNCHER_OPEN_DESKTOP}
                  aria-label={TEXT.LAUNCHER_OPEN_DESKTOP}
                  onClick={openActiveInDesktop}
                >
                  <Monitor className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title={TEXT.MENU_EXPAND}
                  aria-label={TEXT.MENU_EXPAND}
                  onClick={() => dispatch({ type: 'toggle_expand' })}
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
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
            {launcher.ui === 'done' && lastMeta && (
              <div className="da-rise px-1">
                {config?.behavior?.traceDetails ? (
                  <TraceTimeline meta={lastMeta} />
                ) : (
                  <ChatTraceMeta
                    model={lastMeta.model}
                    durationMs={lastMeta.durationMs}
                    toolCount={lastMeta.toolCount ?? lastMeta.steps?.filter((step) => step.phase === 'tool_call').length ?? 0}
                  />
                )}
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
                onClose={() => setMenuOpen(false)}
              />
            )}
            {paletteModel && (
              <CommandPalette
                model={paletteModel}
                pending={sending}
                pinnedIds={palette.pinnedIds}
                argDefaults={config?.commands?.argDefaults}
                onExecute={(entry, argv) => {
                  const mini = miniAppForEntry(entry);
                  if (mini && argv.length === 0) {
                    enterMiniApp(entry);
                    return;
                  }
                  executeCommandEntry(entry, argv);
                }}
                onOpenApp={enterMiniApp}
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
            )}
            {!paletteOpen && !commandHintDismissed && !sending && input.length === 0 && (
              <button
                type="button"
                data-no-drag
                className="self-start rounded-full border border-[var(--as-border)] bg-[var(--as-surface)]/60 px-2 py-0.5 text-[10px] opacity-60 transition-opacity hover:opacity-100"
                onClick={() => setCommandHintDismissed(true)}
              >
                {TEXT.COMMAND_HINT}
              </button>
            )}
            {miniApp && (
              <div
                data-no-drag
                className="flex items-center gap-2 rounded-lg px-2 py-1"
                style={{ backgroundColor: 'color-mix(in srgb, var(--as-primary) 10%, transparent)' }}
              >
                <span
                  className="flex size-5 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: miniApp.accent }}
                >
                  <MiniAppIcon app={miniApp} />
                </span>
                <span className="text-xs font-medium">{miniApp.title}</span>
                <span className="text-[10px] opacity-60">{miniApp.hint}</span>
                <button
                  type="button"
                  className="ml-auto opacity-60 hover:opacity-100"
                  aria-label={interpolate(TEXT.COMMAND_MINI_EXIT_TITLE, { app: miniApp.title })}
                  onClick={exitMiniApp}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            )}
            {miniApp && input.trim() && (() => {
              const result = evaluateExpression(input.trim());
              if (!result.ok) {
                return null;
              }
              const revealCopy = miniRowHover || miniCopied;
              return (
                <button
                  type="button"
                  data-no-drag
                  role="status"
                  aria-label={TEXT.COMMAND_COPY_RESULT}
                  onClick={copyMiniResult}
                  onMouseEnter={() => setMiniRowHover(true)}
                  onMouseLeave={() => setMiniRowHover(false)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm font-medium hover:bg-[var(--as-secondary)]"
                >
                  {interpolate(TEXT.COMMAND_CALC_RESULT, { value: formatCalcResult(result.value) })}
                  <span
                    className="ml-auto flex shrink-0 items-center gap-1 text-xs font-normal"
                    style={{ opacity: revealCopy ? 1 : 0, transition: 'opacity 120ms ease' }}
                  >
                    {miniCopied ? (
                      <>
                        <Check className="h-3 w-3 text-[var(--as-primary)]" aria-hidden />
                        {TEXT.COMMAND_COPY_DONE}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden />
                        {TEXT.COPY_BUTTON}
                      </>
                    )}
                  </span>
                </button>
              );
            })()}
            <ContextChips onInsert={insertContext} />
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
