import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ChatPanel } from '@neuronection/assistant-ui/chat-panel';
import { ChatSessionList } from '@neuronection/assistant-ui/chat-session-list';
import { Ellipsis, Eraser, Heart, History, Plus, Settings, X } from 'lucide-react';
import { ThemeType } from '@shared/constants/themes';
import { WINDOW_SIZE, getWindowSize } from '@shared/constants/window';
import { TEXT } from '@shared/constants/text';
import { AiTask, WindowState } from '@shared/types';
import { initialLauncherState, launcherReducer } from './launcherState';
import { RESPONSE_PANEL_CHROME_PX, compactWindowHeight, desiredResponsePanelHeight } from './launcherLayout';
import { useLauncherResize } from './useLauncherResize';
import { scrollTranscriptToResponseStart, type TranscriptResponseTarget } from './transcriptScroll';
import { Composer } from './Composer';
import { ScreenPicker } from './ScreenPicker';
import { useChatSession } from './useChatSession';
import { usePushToTalk } from './usePushToTalk';
import { useLatestRef } from './useLatestRef';
import { CommandPalette } from './CommandPalette';
import { LaunchPane } from '@renderer/shared/LaunchPane';
import { RunReportModal } from '@renderer/shared/RunReportModal';
import { formatSlashEntry } from './commandSource';
import { useCommandPalette } from './useCommandPalette';
import { miniAppForEntry, packIdForEntry } from './miniApps';
import { useMiniApps } from './useMiniApps';
import type { CommandEntry } from '@shared/commands';
import type { MiniAppView } from '@shared/app-pack';
import { hasLaunchMenu, startAssessmentLaunch } from '@renderer/shared/PackLaunchMenu';
import { openRunReportWindow } from '@renderer/shared/runReportHost';
import type { PackLaunchValues } from '@renderer/shared/PackLaunchMenu';
import type { LaunchOutcome } from '@renderer/shared/LaunchPane';
import { useClipboardOffer } from './useClipboardOffer';
import { useWindowHeaderDrag } from './useWindowHeaderDrag';
import { ResizeHandle } from './ResizeHandle';
import { beginDialog, endDialog, isDialogOpen } from './dialogGuard';
import { NOTICE_ACTION_TIMEOUT_MS, NOTICE_EVENT, NOTICE_TIMEOUT_MS, nextNotice, noticeActionFor, notificationNotice, toNoticeEvent, type NoticeAction, type NoticeState } from './notice';
import { hasConfiguredProvider } from '@shared/ai/providerPresets';
import { findActiveDownload } from './DownloadCard';
import { ExpandableTraceMeta } from './TraceTimeline';
import { NoticeBanner } from './NoticeBanner';
import { CompactFlow } from './areas/CompactFlow';
import { SpeechDiscoveryCard } from './SpeechDiscoveryCard';
import { RecentSpeechPanel } from './RecentSpeechPanel';
import { ShortcutsSheet } from './ShortcutsSheet';
import { ComposerStack } from './areas/ComposerStack';
import { ResponseFlow } from './areas/ResponseFlow';
import { LauncherMetaRow } from './areas/LauncherMetaRow';
import { TranscriptArea } from './areas/TranscriptArea';
import { DesktopModeIcon, LauncherModeIcon } from '@renderer/shared/modeIcons';
import { useWindowSelection } from './useWindowSelection';

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
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const panelStickRef = useRef<boolean>(true);
  const panelHRef = useRef<number>(WINDOW_SIZE.LAUNCHER_RESPONSE_BASE_HEIGHT);
  const [panelH, setPanelH] = useState<number>(WINDOW_SIZE.LAUNCHER_RESPONSE_BASE_HEIGHT);
  const [chromeH, setChromeH] = useState<number>(0);
  const chromeHRef = useRef<number>(0);
  const [panelClamped, setPanelClamped] = useState<boolean>(false);
  const panelClampedRef = useRef<boolean>(false);
  const [manualResize, setManualResize] = useState<boolean>(false);
  const [speechHistoryOpen, setSpeechHistoryOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState<boolean>(false);
  const manualResizeRef = useRef<boolean>(false);
  const {
    request: requestLauncherResize,
    resizeNow: resizeLauncherNow,
    cancel: cancelLauncherResize,
  } = useLauncherResize();

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
    speechProgress,
    toggleSpeechPause,
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
    liveSnapshot,
    liveActive,
    liveFullDuplex,
    liveIgnoredHint,
    voiceInterimSent,
    startLive,
    stopLive,
    interruptLive,
    setLiveFullDuplex,
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
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const activeDownload = useMemo(() => findActiveDownload(trace.steps), [trace]);
  const selection = useWindowSelection(true);
  const speakSelection = (text: string): void => {
    window.getSelection()?.removeAllRanges();
    void speakText(text);
  };
  const editOptionsRef = useRef<() => void>(() => undefined);
  const miniApps = useMiniApps({ input, setInput, composerRef, config, onEditOptions: () => editOptionsRef.current() });
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

  const [launchPacks, setLaunchPacks] = useState<MiniAppView[]>([]);
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const [launchTarget, setLaunchTarget] = useState<{ entry: CommandEntry | null; pack: MiniAppView; mode: 'launch' | 'edit' } | null>(null);
  const paletteOpen = paletteModel !== null;

  const refreshLaunchPacks = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.getMiniApps !== 'function') {
      return;
    }
    try {
      const state = await window.electronAPI.getMiniApps();
      setLaunchPacks(state.packs.filter((pack) => pack.enabled));
    } catch {
      setLaunchPacks([]);
    }
  }, []);

  useEffect(() => {
    void refreshLaunchPacks();
  }, [refreshLaunchPacks]);

  useEffect(() => {
    if (paletteOpen) {
      void refreshLaunchPacks();
    }
  }, [paletteOpen, refreshLaunchPacks]);

  const packForEntry = useCallback(
    (entry: CommandEntry): MiniAppView | null => {
      const packId = packIdForEntry(entry);
      return packId !== null ? launchPacks.find((pack) => pack.id === packId) ?? null : null;
    },
    [launchPacks]
  );

  const routeMiniEntry = useCallback(
    (entry: CommandEntry): boolean => {
      const pack = packForEntry(entry);
      if (!pack || !hasLaunchMenu(pack)) {
        return false;
      }
      if (entry.id.startsWith('miniapp:run:') && !pack.launchOptions?.some((option) => option.type === 'path')) {
        return false;
      }
      setLaunchTarget({ entry, pack, mode: 'launch' });
      return true;
    },
    [packForEntry]
  );

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

  const browseMiniAppRoot = useCallback(async (): Promise<string | null> => {
    beginDialog();
    try {
      const picked = await window.electronAPI.pickMiniAppRoot();
      return picked.ok ? picked.root : null;
    } finally {
      endDialog();
    }
  }, []);

  const openRunsFor = useCallback(
    (pack: MiniAppView): void => {
      void window.electronAPI.onSettingsOpen({ tab: 'apps', miniAppsReportPackId: pack.id });
      setLaunchTarget(null);
      palette.close();
    },
    [palette]
  );

  const openConfigure = useCallback(
    (pack: MiniAppView): void => {
      void window.electronAPI.onSettingsOpen({ tab: 'apps', miniAppsConfigurePackId: pack.id });
      setLaunchTarget(null);
      palette.close();
    },
    [palette]
  );

  const openRunReport = useCallback(async (packId: string, runId: string): Promise<void> => {
    if (await openRunReportWindow(packId, runId)) {
      return;
    }
    dispatch({ type: 'auto_expand' });
    setReportRunId(runId);
  }, []);

  const handlePaneLaunch = useCallback(
    async (values: PackLaunchValues): Promise<LaunchOutcome | void> => {
      const target = launchTarget;
      if (!target) {
        return;
      }
      const { pack, entry, mode } = target;
      if (mode === 'edit') {
        if (!miniApps.updateMiniAppOptions(values)) {
          return { error: { message: TEXT.MINIAPPS_LAUNCH_LIVE_UNAVAILABLE } };
        }
        setLaunchTarget(null);
        composerRef.current?.focus();
        return;
      }
      if (entry === null) {
        setLaunchTarget(null);
        return;
      }
      if (entry.id.startsWith('miniapp:run:')) {
        const started = await startAssessmentLaunch(pack, values);
        if (started.error !== undefined) {
          return { error: started.error };
        }
        setLaunchTarget(null);
        palette.close();
        const report = started.runId !== undefined ? await window.electronAPI.miniAppRunReport(started.runId).catch(() => null) : null;
        const conversationId = report?.run.conversationId ?? null;
        if (conversationId !== null) {
          openConversationDesktop(conversationId);
        }
        return;
      }
      if (!miniApps.enterMiniApp(entry, values)) {
        return { error: { message: TEXT.MINIAPPS_LAUNCH_UNAVAILABLE } };
      }
      setLaunchTarget(null);
      palette.close();
    },
    [launchTarget, miniApps, openConversationDesktop, palette]
  );

  useLayoutEffect(() => {
    editOptionsRef.current = (): void => {
      const activePack = launchPacks.find((pack) => pack.id === miniApps.miniApp?.packId);
      if (activePack) {
        setLaunchTarget({ entry: null, pack: activePack, mode: 'edit' });
      }
    };
  }, [launchPacks, miniApps.miniApp]);

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
        setShortcutsOpen(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const newConversationRef = useLatestRef(newConversation);
  const selectSessionRef = useLatestRef(selectSession);
  const paletteRef = useLatestRef(palette);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherToggleExpand?.(() => dispatch({ type: 'toggle_expand' }));
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherNewConversation?.(() => {
      void newConversationRef.current();
    });
    return () => unsubscribe?.();
  }, [newConversationRef]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionSync?.((conversationId) => {
      void selectSessionRef.current(conversationId);
    });
    return () => unsubscribe?.();
  }, [selectSessionRef]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherSetMode?.((mode) => {
      dispatch({ type: mode === 'expanded' ? 'auto_expand' : 'collapse' });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLauncherOpenPalette?.(() => {
      paletteRef.current.requestOpen();
    });
    return () => unsubscribe?.();
  }, [paletteRef]);

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
    const unsubscribe = window.electronAPI.onMiniAppRunEvent?.((event) => {
      if (event.type !== 'run:finished') {
        return;
      }
      setNotice((current) =>
        nextNotice(current, {
          type: 'success',
          message: TEXT.MINIAPPS_RUN_FINISHED_NOTICE,
          action: { label: TEXT.MINIAPPS_REPORT_OPEN, target: 'miniapp-report', packId: event.packId, runId: event.runId },
        })
      );
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onNotificationsChanged?.((change) => {
      if (change.reason !== 'created' || !change.record) {
        return;
      }
      setNotice((current) => nextNotice(current, notificationNotice(change.record!)));
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let alive = true;
    void window.electronAPI.getUpdateStatus?.().then((state) => {
      if (alive) setUpdateVersion(state.release?.tag ?? null);
    }).catch(() => undefined);
    const unsubscribe = window.electronAPI.onUpdateState?.((state) => {
      setUpdateVersion(state.release?.tag ?? null);
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const actionable = notice.action !== undefined || noticeActionFor(notice.message, hasConfiguredProvider(config?.providers)) !== null;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, actionable ? NOTICE_ACTION_TIMEOUT_MS : NOTICE_TIMEOUT_MS[notice.type]);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const blurStateRef = useLatestRef({
    hideOnBlur: config?.behavior?.hideOnBlur === true,
    voiceState,
    pickerOpen,
    confirmClear,
    deletingSession,
  });

  useLayoutEffect(() => {
    const onHide = (): void => {
      const current = blurStateRef.current;
      // Dev keeps the launcher up when focus moves to DevTools — the
      // click-away hide makes renderer debugging impossible otherwise.
      if (process.env.NODE_ENV === 'development') {
        return;
      }
      // Opt-in (Settings → General): the launcher never hides on blur
      // unless hide-on-blur is enabled.
      if (!current.hideOnBlur) {
        return;
      }
      if (current.voiceState !== 'idle' || current.pickerOpen || current.confirmClear || current.deletingSession !== null || isDialogOpen()) {
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
  }, []);

  const keyStateRef = useLatestRef({
    launcherUi: launcher.ui,
    openActiveInDesktop,
    voiceState,
    miniApps,
    liveActive,
    liveSnapshot,
    interruptLive,
    stopLive,
    requestPalette: palette.requestOpen,
    closePalette: palette.close,
    attachMenuOpen,
  });

  useLayoutEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const current = keyStateRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (current.miniApps.miniApp) {
          current.miniApps.exitMiniApp();
          return;
        }
        dispatch({ type: 'toggle_expand' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        current.openActiveInDesktop();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) {
        if (current.launcherUi === 'expanded' || current.attachMenuOpen) {
          return;
        }
        e.preventDefault();
        current.closePalette();
        setMenuOpen(false);
        exitManualResize();
        setShortcutsOpen((open) => !open);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShortcutsOpen(false);
        current.requestPalette();
        return;
      }
      if (e.key === 'Escape' && current.miniApps.miniApp) {
        e.preventDefault();
        current.miniApps.exitMiniApp();
        return;
      }
      if (e.key === 'Escape' && current.liveActive) {
        e.preventDefault();
        if (current.liveSnapshot?.state === 'speaking') {
          current.interruptLive();
        } else {
          current.stopLive();
        }
        return;
      }
      if (e.key === 'Escape' && current.voiceState === 'idle') {
        if (current.launcherUi === 'expanded') {
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
  }, []);

  useEffect(() => {
    if (launcher.ui !== 'thinking' && launcher.ui !== 'idle' && launcher.ui !== 'failed') {
      return;
    }
    panelHRef.current = RESPONSE_PANEL_CHROME_PX;
    setPanelH(RESPONSE_PANEL_CHROME_PX);
    panelClampedRef.current = false;
    setPanelClamped(false);
  }, [launcher.ui]);

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
  }, [launcher.ui]);

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
      resizeLauncherNow(size.height, size.width);
      return;
    }
    if (pickerOpen) {
      resizeLauncherNow(WINDOW_SIZE.SCREEN_SOURCE_PICKER_HEIGHT);
      return;
    }
    // A manual corner drag owns the window until the next turn, dismiss or
    // session change — otherwise every streaming delta snaps the user's
    // size back to the content-fit budget.
    if (manualResize) {
      cancelLauncherResize();
      return;
    }
    requestLauncherResize(Math.max(compactWindowHeight(launcher.ui, chromeH, panelH), WINDOW_SIZE.MIN_HEIGHT), {
      streaming: launcher.ui === 'responding',
      deferShrink: launcher.ui === 'done',
    });
  }, [
    launcher.ui,
    historyVisible,
    chromeH,
    panelH,
    pickerOpen,
    manualResize,
    requestLauncherResize,
    resizeLauncherNow,
    cancelLauncherResize,
  ]);

  const responseScrollTarget = useMemo<TranscriptResponseTarget | null>(() => {
    if (liveView) {
      return { live: true, messageId: null };
    }
    return lastAssistant?.id ? { live: false, messageId: lastAssistant.id } : null;
  }, [liveView, lastAssistant?.id]);
  const expandedFocusPendingRef = useRef(false);
  const previousLauncherUiRef = useRef(launcher.ui);

  useLayoutEffect(() => {
    const enteredExpanded = previousLauncherUiRef.current !== 'expanded' && launcher.ui === 'expanded';
    previousLauncherUiRef.current = launcher.ui;
    if (enteredExpanded) {
      expandedFocusPendingRef.current = true;
    }
    if (launcher.ui !== 'expanded') {
      expandedFocusPendingRef.current = false;
      return;
    }
    if (!expandedFocusPendingRef.current) {
      return;
    }
    if (!responseScrollTarget) {
      if (messages.length > 0) {
        expandedFocusPendingRef.current = false;
      }
      return;
    }
    let second: number | null = null;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!expandedFocusPendingRef.current) {
          return;
        }
        if (scrollTranscriptToResponseStart(transcriptRef.current, responseScrollTarget)) {
          expandedFocusPendingRef.current = false;
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== null) {
        cancelAnimationFrame(second);
      }
    };
  }, [launcher.ui, responseScrollTarget, messages.length]);

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
        type="button"
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
        type="button"
        variant="ghost"
        size="icon"
        className="relative size-7"
        title={TEXT.LAUNCHER_MORE_BUTTON}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setShortcutsOpen(false);
          setMenuOpen((open) => !open);
        }}
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden />
        {updateVersion !== null && (
          <span
            aria-hidden
            className="bg-primary absolute right-1.5 top-1.5 size-1.5 rounded-full"
          />
        )}
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

  const inlineTraceMeta =
    launcher.ui === 'done' && lastMeta && config?.behavior?.traceDetails !== true ? lastMeta : undefined;
  const conversationMeta = (
    <LauncherMetaRow
      messageCount={messages.length}
      live={launcher.ui === 'thinking' || launcher.ui === 'responding'}
      phase={trace.phase}
      startedAt={trace.startedAt}
      steps={trace.steps}
      doneMeta={inlineTraceMeta}
      onToggleExpand={() => dispatch({ type: 'toggle_expand' })}
      onNewConversation={() => void newConversation()}
    />
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
      speechProgress={speechProgress}
      onPauseSpeaking={toggleSpeechPause}
      onAttachMenuOpenChange={setAttachMenuOpen}
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
      clipboardOffer={clipboardOffer}
      onInsertClipboard={insertContext}
      textareaRef={composerRef}
      placeholder={miniApps.miniApp?.placeholder}
      toolbarEnd={launcher.ui === 'expanded' ? undefined : launcherToolbar}
    />
  );

  const paletteNode = launchTarget ? (
    <LaunchPane
      pack={launchTarget.pack}
      primaryLabel={launchTarget.mode === 'edit' ? TEXT.MINIAPPS_LAUNCH_APPLY : undefined}
      onBack={() => {
        setLaunchTarget(null);
        composerRef.current?.focus();
      }}
      onLaunch={handlePaneLaunch}
      onOpenRuns={() => openRunsFor(launchTarget.pack)}
      onConfigure={() => openConfigure(launchTarget.pack)}
      onBrowsePath={browseMiniAppRoot}
    />
  ) : paletteModel ? (
    <CommandPalette
      model={paletteModel}
      pending={sending}
      pinnedIds={palette.pinnedIds}
      argDefaults={config?.commands?.argDefaults}
      onExecute={(entry, argv) => {
        if (argv.length === 0 && routeMiniEntry(entry)) {
          return;
        }
        const mini = miniAppForEntry(entry);
        if (mini && argv.length === 0 && miniApps.enterMiniApp(entry)) {
          return;
        }
        executeCommandEntry(entry, argv);
      }}
      onOpenApp={(entry) => {
        if (!routeMiniEntry(entry)) {
          miniApps.enterMiniApp(entry);
        }
      }}
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

  const derivedNoticeAction = notice ? noticeActionFor(notice.message, hasConfiguredProvider(config?.providers)) : null;
  const noticeAction: NoticeAction | null = notice
    ? (notice.action ?? derivedNoticeAction)
    : null;
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
                if (noticeAction.target === 'notification') {
                  if (noticeAction.notificationId) {
                    void window.electronAPI.clickNotification?.(noticeAction.notificationId);
                  }
                  return;
                }
                if (noticeAction.target === 'miniapp-report') {
                  if (noticeAction.runId !== undefined) {
                    dispatch({ type: 'auto_expand' });
                    setReportRunId(noticeAction.runId);
                  }
                  return;
                }
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
            <aside data-no-drag className="flex w-64 shrink-0 flex-col border-r border-[var(--as-border)] p-2">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-semibold opacity-80">{TEXT.MENU_HISTORY}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title={TEXT.LAUNCHER_HISTORY_CLOSE}
                  aria-label={TEXT.LAUNCHER_HISTORY_CLOSE}
                  onClick={() => {
                    setHistoryVisible(false);
                    setShowSessions(false);
                  }}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1 -m-1">
                <ChatSessionList
                  sessions={conversations}
                  activeId={activeId}
                  onSelect={(id) => void selectSession(id)}
                  onNew={() => void newConversation()}
                  onDelete={(id) => setDeletingSession(id)}
                  searchable={true}
                  groupByDate={false}
                />
              </div>
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
                    <History className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="default"
                    size="icon"
                    className="size-7"
                    title={TEXT.MENU_NEW_CONVERSATION}
                    aria-label={TEXT.MENU_NEW_CONVERSATION}
                    onClick={() => void newConversation()}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={TEXT.LAUNCHER_CLEAR_CONVERSATION}
                    aria-label={TEXT.LAUNCHER_CLEAR_CONVERSATION}
                    onClick={() => setConfirmClear(true)}
                  >
                    <Eraser className="h-4 w-4" aria-hidden />
                  </Button>
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={TEXT.DESKTOP_HIDE_TO_TRAY}
                    aria-label={TEXT.DESKTOP_HIDE_TO_TRAY}
                    onClick={() => void window.electronAPI.hideWindow()}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              }
              transcript={
                <TranscriptArea
                  transcriptRef={transcriptRef}
                  messages={messages}
                  autoScroll={config?.behavior?.autoScroll ?? false}
                  providers={config?.providers}
                  liveView={liveView}
                  trace={trace}
                  traceDetails={config?.behavior?.traceDetails}
                  onEdit={session.editMessage}
                  onRegenerate={session.regenerateMessage}
                  onSelectVariant={session.selectVariant}
                  onOpenRunReport={(packId, runId) => void openRunReport(packId, runId)}
                />
              }
              composer={
                <ComposerStack
                  noticeBanner={noticeBanner}
                  pendingApproval={pendingApproval}
                  resolveApproval={resolveApproval}
                  activeDownload={activeDownload}
                  paletteNode={paletteNode}
                  miniAppsSurface={miniApps.surface}
                  composer={composer}
                />
              }
            />
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col justify-end">
          {(launcher.ui === 'responding' || launcher.ui === 'done') && (
            <ResponseFlow
              ui={launcher.ui}
              lastAssistant={lastAssistant}
              speechState={speechState}
              onSpeak={(text) => void speakText(text)}
              onOpenDesktop={openActiveInDesktop}
              onToggleExpand={() => dispatch({ type: 'toggle_expand' })}
              responseContent={responseContent}
              onSelectVariant={session.selectVariant}
              panelScrollRef={panelScrollRef}
              panelContentRef={panelContentRef}
              panelStickRef={panelStickRef}
              panelClamped={panelClamped}
            />
          )}
          <div ref={chromeRef} className="flex flex-col gap-1.5 p-3">
            <CompactFlow
              noticeBanner={noticeBanner}
              speechDiscovery={
                launcher.ui === 'idle' ? (
                  <SpeechDiscoveryCard
                    assigned={Boolean(config?.taskAssignments?.[AiTask.TTS])}
                    onSetupVoice={() => {
                      void window.electronAPI.onSettingsOpen({ tab: 'api', section: 'tasks' });
                      void window.electronAPI.hideWindow();
                    }}
                  />
                ) : null
              }
              speechHistory={
                speechHistoryOpen ? <RecentSpeechPanel onClose={() => setSpeechHistoryOpen(false)} /> : null
              }
              shortcutsSheet={shortcutsOpen ? <ShortcutsSheet onClose={() => setShortcutsOpen(false)} /> : null}
              pendingApproval={pendingApproval}
              resolveApproval={resolveApproval}
              activeDownload={activeDownload}
              launcherDone={launcher.ui === 'done'}
              launcherFailed={launcher.ui === 'failed'}
              lastMeta={lastMeta}
              traceDetails={config?.behavior?.traceDetails}
              artifacts={trace.artifacts}
              failedMessage={live.live?.error?.message ?? TEXT.LAUNCHER_TURN_FAILED}
              onDismissError={goIdle}
              menuOpen={menuOpen}
              conversations={conversations}
              activeId={activeId}
              onMenuToggleExpand={() => {
                setMenuOpen(false);
                dispatch({ type: 'toggle_expand' });
              }}
              onMenuOpenDesktop={() => {
                setMenuOpen(false);
                openActiveInDesktop();
              }}
              onMenuNewConversation={() => {
                setMenuOpen(false);
                void newConversation();
              }}
              onMenuOpenSettings={() => {
                setMenuOpen(false);
                void window.electronAPI.onSettingsOpen();
                void window.electronAPI.hideWindow();
              }}
              onMenuHide={() => void window.electronAPI.hideWindow()}
              updateVersion={updateVersion}
              onMenuOpenUpdate={() => {
                setMenuOpen(false);
                void window.electronAPI.onSettingsOpen({ tab: 'about' });
                void window.electronAPI.hideWindow();
              }}
              onMenuOpenAbout={() => {
                setMenuOpen(false);
                void window.electronAPI.onSettingsOpen({ tab: 'about' });
                void window.electronAPI.hideWindow();
              }}
              onMenuOpenConversation={(id) => {
                setMenuOpen(false);
                void openConversationExpanded(id);
              }}
              onMenuOpenConversationDesktop={openConversationDesktop}
              onMenuOpenSpeechHistory={() => setSpeechHistoryOpen(true)}
              onMenuOpenShortcuts={() => setShortcutsOpen(true)}
              onMenuClose={() => setMenuOpen(false)}
              fundOpen={fundOpen}
              onFundClose={() => setFundOpen(false)}
              paletteNode={paletteNode}
              miniAppsSurface={miniApps.surface}
              conversationMeta={conversationMeta}
            />
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

      {reportRunId !== null && <RunReportModal runId={reportRunId} onClose={() => setReportRunId(null)} />}
    </div>
  );
}
