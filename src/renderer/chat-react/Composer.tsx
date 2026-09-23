import { useEffect, useRef, useState, type ClipboardEvent, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ChatComposer } from '@neuronection/assistant-ui/chat-composer';
import { FileCard } from '@neuronection/assistant-ui/file-card';
import { Mic, MonitorUp, Paperclip, Clipboard, Radio, Square, TextCursorInput, Volume2, X } from 'lucide-react';
import { Attachment } from '@shared/types';
import type { LiveSnapshot } from '@shared/live';
import { TEXT, interpolate } from '@shared/constants/text';
import { beginDialog, endDialog } from './dialogGuard';
import { attachmentDisplayName } from './MessageAttachments';
import { VoiceIndicator, type VoiceState } from './VoiceIndicator';
import { SpeechBar } from './SpeechBar';
import type { ClipboardOffer } from './useClipboardOffer';

export interface ComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  /** Stops the in-flight turn (cancel stream) — renders the composer stop control while sending. */
  onStop?: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (index: number) => void;
  onAttachFiles: (files: File[]) => void;
  onPickScreen: () => void;
  onToggleRecording: () => void;
  onCancelRecording?: () => void;
  onClearInterim?: () => void;
  voiceState: VoiceState;
  voiceLevel: number;
  voiceInterim?: string;
  voiceAvailable?: boolean;
  /** Live conversation mode (plan 25): the Live toggle replaces the mic control. */
  liveActive?: boolean;
  liveState?: LiveSnapshot['state'];
  liveFullDuplex?: boolean;
  onToggleLive?: () => void;
  onToggleDuplex?: () => void;
  /** Transient hint of the last utterance the live loop ignored (opt-in). */
  liveIgnoredHint?: string | null;
  /** The shown transcript is the last phrase sent in live mode (renders a delivered check). */
  voiceInterimSent?: boolean;
  /** Speech feedback state — drives the speaking bar and selection-button gating. */
  speechState?: 'idle' | 'loading' | 'speaking';
  onStopSpeaking?: () => void;
  /** Opt-in (X11 only): passively reads the primary selection on click and inserts it. */
  onInsertSelection?: () => Promise<string | null>;
  /** Current in-window text selection — shows the speak-selection toolbar button while non-empty. */
  selection?: string;
  onSpeakSelection?: (text: string) => void;
  /** Changed-since-last-summon clipboard — shows the clipboard toolbar button while present. */
  clipboardOffer?: ClipboardOffer | null;
  onInsertClipboard?: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  toolbarEnd?: React.ReactNode;
  placeholder?: string;
}

export function Composer(props: ComposerProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionHint, setSelectionHint] = useState<string | null>(null);

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
    }
  };

  useEffect(() => {
    if (!attachMenuOpen) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!selectionHint) {
      return undefined;
    }
    const timer = setTimeout(() => setSelectionHint(null), 3500);
    return () => clearTimeout(timer);
  }, [selectionHint]);

  const insertSelection = (): void => {
    if (!props.onInsertSelection || selectionBusy) {
      return;
    }
    setSelectionBusy(true);
    setSelectionHint(null);
    void props
      .onInsertSelection()
      .then((error) => {
        if (error) {
          setSelectionHint(error);
        }
      })
      .catch(() => setSelectionHint(TEXT.CONTEXT_NO_SELECTION))
      .finally(() => setSelectionBusy(false));
  };

  return (
    <div onPaste={onPaste}>
      <SpeechBar state={props.speechState ?? 'idle'} onStop={props.onStopSpeaking} />
      {props.liveActive && props.liveState && (
        <div className="mb-1 flex items-center gap-2 px-1 text-xs text-[var(--as-muted-foreground)]">
          <span role="status" aria-live="polite">
            {liveStateText(props.liveState)}
          </span>
          {props.onToggleDuplex && (
            <button
              type="button"
              aria-pressed={props.liveFullDuplex === true}
              title={props.liveFullDuplex ? TEXT.LIVE_DUPLEX_ON_HINT : TEXT.LIVE_DUPLEX_OFF_HINT}
              className={`rounded-full border px-1.5 py-0.5 transition-colors ${
                props.liveFullDuplex
                  ? 'border-[var(--as-primary)] text-[var(--as-primary)]'
                  : 'border-[var(--as-border)]'
              }`}
              onClick={props.onToggleDuplex}
            >
              {TEXT.LIVE_DUPLEX_TOGGLE}
            </button>
          )}
        </div>
      )}
      {props.liveActive && props.liveIgnoredHint && (
        <div className="mb-1 px-1 text-xs italic text-[var(--as-muted-foreground)] opacity-70">
          {interpolate(TEXT.LIVE_IGNORED_HINT, { text: props.liveIgnoredHint })}
        </div>
      )}
      <VoiceIndicator
        state={props.voiceState}
        level={props.voiceLevel}
        interim={props.voiceInterim}
        sent={props.voiceInterimSent}
        onCancel={props.onCancelRecording}
        onClearInterim={props.onClearInterim}
      />
      {attachMenuOpen && (
        <div
          data-no-drag
          role="menu"
          className="da-rise mb-1 flex flex-col overflow-hidden rounded-lg border border-[var(--as-border)] bg-[var(--as-surface-raised)] text-sm shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left hover:bg-[var(--as-secondary)]"
            onClick={() => {
              setAttachMenuOpen(false);
              beginDialog();
              window.addEventListener('focus', endDialog, { once: true });
              fileInputRef.current?.click();
            }}
          >
            {TEXT.COMPOSER_SELECT_FROM_FILES}
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left hover:bg-[var(--as-secondary)]"
            onClick={() => {
              setAttachMenuOpen(false);
              props.onPickScreen();
            }}
          >
            {TEXT.COMPOSER_SHARE_SCREEN}
          </button>
        </div>
      )}
      {selectionHint && (
        <p role="status" className="mb-1 px-1 text-[11px] opacity-60">
          {selectionHint}
        </p>
      )}
      {selectionBusy && (
        <p role="status" className="sr-only">
          {TEXT.CONTEXT_SELECTION_BUSY}
        </p>
      )}
      <ChatComposer
        value={props.value}
        onValueChange={props.onValueChange}
        onSubmit={props.onSubmit}
        sending={props.sending}
        onStop={props.onStop}
        textareaRef={props.textareaRef}
        placeholder={props.placeholder ?? TEXT.COMPOSER_PLACEHOLDER}
        onAttachFiles={props.onAttachFiles}
        labels={{ dropFiles: TEXT.DESKTOP_DROP_FILES, stop: TEXT.COMPOSER_STOP_STREAM }}
        attachments={
          props.attachments.length > 0 ? (
            <div className="px-1 pb-1">
              <p className="text-xs text-[var(--as-muted-fg)]">
                {interpolate(TEXT.COMPOSER_ATTACHMENT_SUMMARY, { count: props.attachments.length })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {props.attachments.map((attachment, index) => (
                  <div key={`${attachment.type}-${index}`} className="relative">
                    <FileCard
                      name={attachmentDisplayName(attachment)}
                      status="queued"
                      thumbnailUrl={attachment.type === 'pdf' ? null : attachment.data}
                    />
                    <button
                      type="button"
                      aria-label={interpolate(TEXT.COMPOSER_REMOVE_ATTACHMENT, { index: index + 1 })}
                      className="absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded-full bg-[var(--as-surface-raised)] text-[var(--as-muted-fg)] shadow-[var(--as-shadow-1)] transition-colors hover:text-[var(--as-danger)]"
                      onClick={() => props.onRemoveAttachment(index)}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : undefined
        }
        toolbarStart={
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={TEXT.COMPOSER_ATTACH_FILES}
              aria-haspopup="menu"
              aria-expanded={attachMenuOpen}
              onClick={() => setAttachMenuOpen((open) => !open)}
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" title={TEXT.COMPOSER_SHARE_SCREEN} onClick={props.onPickScreen}>
              <MonitorUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            {props.voiceAvailable !== false && (
              <Button
                variant={props.voiceState === 'recording' ? 'destructive' : 'ghost'}
                size="icon"
                className="size-7"
                disabled={props.voiceState === 'transcribing' || props.liveActive === true}
                title={props.voiceState === 'recording' ? TEXT.COMPOSER_STOP_RECORDING : TEXT.COMPOSER_VOICE_INPUT}
                onClick={props.onToggleRecording}
              >
                {props.voiceState === 'recording' ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
              </Button>
            )}
            {props.onToggleLive && (
              <Button
                variant={props.liveActive ? 'destructive' : 'ghost'}
                size="icon"
                className="size-7"
                aria-pressed={props.liveActive === true}
                aria-label={props.liveActive ? TEXT.LIVE_STOP : TEXT.LIVE_START}
                title={props.liveActive ? TEXT.LIVE_STOP : TEXT.LIVE_START}
                onClick={props.onToggleLive}
              >
                <Radio className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
            {props.onInsertSelection && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={selectionBusy}
                title={TEXT.COMPOSER_INSERT_SELECTION}
                aria-label={TEXT.COMPOSER_INSERT_SELECTION}
                onClick={insertSelection}
              >
                <TextCursorInput className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
            {props.onSpeakSelection && props.selection && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={props.speechState === 'loading'}
                title={TEXT.SPEECH_SPEAK_SELECTION}
                aria-label={TEXT.SPEECH_SPEAK_SELECTION}
                onClick={() => props.onSpeakSelection?.(props.selection ?? '')}
              >
                <Volume2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
            {props.onInsertClipboard && props.clipboardOffer && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={
                  props.clipboardOffer.preview
                    ? `${TEXT.CONTEXT_CLIPBOARD} — ${props.clipboardOffer.preview}`
                    : TEXT.CONTEXT_CLIPBOARD
                }
                aria-label={TEXT.CONTEXT_CLIPBOARD}
                onClick={() => props.onInsertClipboard?.(props.clipboardOffer?.text ?? '')}
              >
                <Clipboard className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>
        }
        toolbarEnd={
          <div className="flex items-center gap-0.5">
            {props.toolbarEnd}
            <Button variant="ghost" size="icon" className="size-7" title={TEXT.DESKTOP_HIDE_TO_TRAY} onClick={() => window.electronAPI.hideWindow()}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        aria-label={TEXT.COMPOSER_ATTACH_FILES}
        multiple={true}
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          props.onAttachFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function liveStateText(state: LiveSnapshot['state']): string {
  switch (state) {
    case 'arming':
    case 'listening':
    case 'transcribing':
      return TEXT.LIVE_STATE_LISTENING;
    case 'thinking':
      return TEXT.LIVE_STATE_THINKING;
    case 'preparing':
      return TEXT.LIVE_STATE_PREPARING;
    case 'speaking':
      return TEXT.LIVE_STATE_SPEAKING;
    case 'paused':
      return TEXT.LIVE_STATE_PAUSED;
    case 'error':
      return TEXT.LIVE_STATE_ERROR;
    case 'idle':
      return '';
  }
}
