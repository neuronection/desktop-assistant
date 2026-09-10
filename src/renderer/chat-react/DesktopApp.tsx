import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { ChatPanel } from '@neuronection/assistant-ui/chat-panel';
import { ChatSessionList } from '@neuronection/assistant-ui/chat-session-list';
import { ChatTranscript } from '@neuronection/assistant-ui/chat-transcript';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { buildChatMarkdown, chatExportFileName } from '@neuronection/assistant-ui/chat-export';
import type { ChatToolCatalogEntry } from '@neuronection/assistant-ui/chat-tools-catalog';
import { Minus, PanelRightClose, PanelRightOpen, Settings, SquarePen, X } from 'lucide-react';
import { useChatSession } from './useChatSession';
import { useCommandPalette } from './useCommandPalette';
import { CommandPalette } from './CommandPalette';
import { useWindowHeaderDrag } from './useWindowHeaderDrag';
import { TraceTimeline } from './TraceTimeline';
import { FlowCard, hasFlowTimeline } from './FlowCard';
import type { TurnMetadata } from '@shared/turns';
import { Composer } from './Composer';
import { MessageAttachments } from './MessageAttachments';
import { ScreenPicker } from './ScreenPicker';
import { Inspector } from './Inspector';
import { SCROLL_STICK_THRESHOLD_PX } from './launcherLayout';
import { ApprovalCard } from './ApprovalCard';
import { slashExampleFor } from '@shared/commands';
import { beginDialog, endDialog } from './dialogGuard';
import { TEXT } from '@shared/constants/text';

export function DesktopApp(): JSX.Element {
  const session = useChatSession();
  const palette = useCommandPalette({
    input: session.input,
    setInput: session.setInput,
    composerRef: session.composerRef,
    executeEntry: session.runCommandEntry,
    sending: session.sending,
  });
  const onHeaderPointerDown = useWindowHeaderDrag();
  const [showInspector, setShowInspector] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [catalog, setCatalog] = useState<ChatToolCatalogEntry[]>([]);
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
    pickerOpen,
    setPickerOpen,
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
    handleFiles,
    captureScreen,
    newConversation,
    selectSession,
    deleteSession,
    clearConversation,
    setConversationModel,
    pendingApproval,
    resolveApproval,
  } = session;

  useEffect(() => {
    const unsubscribe = window.electronAPI.onSessionSync((conversationId) => {
      void selectSession(conversationId);
    });
    return unsubscribe;
  }, [selectSession]);

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

  const activeTitle = manager.getActiveConversation()?.title ?? TEXT.DESKTOP_APP_TITLE;
  const activeModel = manager.getActiveConversation()?.metadata?.modelId ?? config?.defaultChatModelId ?? null;
  const pickerProviders = useMemo(
    () =>
      (config?.providers ?? []).map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: [...(provider.availableModels ?? []), ...(provider.customModels ?? [])].map((m) => ({
          id: m.id,
          name: m.name,
        })),
      })),
    [config]
  );

  const exportConversation = useCallback(
    async (format: 'md' | 'json') => {
      const title = manager.getActiveConversation()?.title ?? TEXT.DESKTOP_EXPORT_FALLBACK_TITLE;
      const content =
        format === 'md'
          ? buildChatMarkdown(
              title,
              messages.map((m) => ({ role: m.role, content: m.content })),
            )
          : JSON.stringify({ title, messages: messages.map(({ role, content, createdAt }) => ({ role, content, createdAt })) }, null, 2);
      const ext = format === 'md' ? 'md' : 'json';
      const fallbackName = format === 'md' ? chatExportFileName(title) : `${title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.json`;
      beginDialog();
      try {
        await window.electronAPI.saveFile({
          title: TEXT.DESKTOP_EXPORT_DIALOG_TITLE,
          defaultPath: fallbackName,
          filters: [{ name: format === 'md' ? TEXT.EXPORT_FORMAT_MARKDOWN : TEXT.EXPORT_FORMAT_JSON, extensions: [ext] }],
          content,
        });
      } finally {
        endDialog();
      }
    },
    [manager, messages]
  );

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
      <aside data-no-drag className="flex w-72 shrink-0 flex-col gap-2 border-r border-[var(--as-border)] p-2">
        <Button variant="outline" size="sm" onClick={() => void newConversation()}>
          <SquarePen className="mr-1 h-3.5 w-3.5" aria-hidden />
          {TEXT.DESKTOP_NEW_CHAT}
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto">
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
      <div className="flex min-w-0 flex-1 flex-col" onPointerDown={onHeaderPointerDown}>
        <ChatPanel
          variant="bubble"
          title={<span className="text-sm font-semibold opacity-80">{activeTitle}</span>}
          actions={
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>{TEXT.CLEAR_BUTTON}</Button>
              <Button
                variant="ghost"
                size="sm"
                title={showInspector ? TEXT.DESKTOP_HIDE_INSPECTOR : TEXT.DESKTOP_SHOW_INSPECTOR}
                onClick={() => setShowInspector((open) => !open)}
              >
                {showInspector ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}
              </Button>
              <Button variant="ghost" size="sm" title={TEXT.LAUNCHER_SETTINGS_TITLE} onClick={() => void window.electronAPI.onSettingsOpen()}>
                <Settings className="h-4 w-4" aria-hidden />
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
              {palette.model && (
                <CommandPalette
                  model={palette.model}
                  pending={session.sending}
                  pinnedIds={palette.pinnedIds}
                  onExecute={palette.execute}
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
              <Composer
                value={input}
                onValueChange={setInput}
                onSubmit={() => void submit(input)}
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
              />
            </div>
          }
        />
      </div>
      {showInspector && (
        <aside className="w-80 shrink-0" data-no-drag>
          <Inspector
            live={live.live}
            liveTrace={{ phase: trace.phase, startedAt: trace.startedAt, steps: trace.steps }}
            lastAssistant={lastAssistant}
            lastUserAttachments={lastUserAttachments}
            activeModel={activeModel}
            modelProviders={pickerProviders}
            onModelChange={(modelId) => void setConversationModel(modelId)}
            onExport={(format) => void exportConversation(format)}
            catalog={catalog}
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
      {pickerOpen && <ScreenPicker onClose={() => setPickerOpen(false)} onSelect={(id) => void captureScreen(id)} />}
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
