import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, EyeOff, Home, Languages, LayoutGrid, Mic, OctagonX, Paperclip, Pause, Play, Radio, ScanLine, Send, Square, Trash2, TriangleAlert, Volume2 } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type { SpeechSnapshot } from '@shared/speech';
import type { LiveSnapshot } from '@shared/live';
import {
  hudPresentation,
  speechDockTextContent,
  speechEdgeFaceSize,
  speechHudBox,
  speechKnobGeometry,
  speechKnobGeometryFor,
  HUD_SIZE_TOKENS,
  type HudPresentation,
  type HudSizeTokens,
  type SpeechHudDock,
  type SpeechHudEdgeSide,
  type SpeechHudStyle,
  type SpeechHudTextContent,
  type SpeechHudVisual,
} from '@shared/speechHud';
import { HUB_ACTIONS, HUB_ACTION_IDS, type HubActionId } from '@shared/hub';
import { dockRow } from '@shared/hubControls';
import { plainTextFromMarkdown, speechTextFromMarkdown } from '@renderer/chat-react/speechText';
import { resolveHubControls } from '@shared/hubControls';
import type { HudDictationState } from './useHudDictation';
import { useHudFlash } from './hudFlash';
import { useHudDrag } from './useHudDrag';

export interface SpeechHudProps {
  snapshot: SpeechSnapshot;
  live?: LiveSnapshot | null;
  style?: SpeechHudStyle;
  edgeSide?: SpeechHudEdgeSide;
  /** Opaque-window fallback (no transparency): squared, no blur reliance. */
  opaque?: boolean;
  /** Last live user transcript (card live face). */
  liveTranscript?: string | null;
  /** Last bounded live reply caption (card live face). */
  liveCaption?: string | null;
  preset?: 'pulse' | 'aurora' | 'minimal' | 'snake' | 'terminal';
  motion?: boolean;
  textScale?: number;
  dock?: SpeechHudDock;
  dockText?: string;
  busy?: boolean;
  micLevel?: number;
  selection?: boolean;
  dictating?: boolean;
  /** `ready` = the mic closed with a transcript: the row offers Continue. */
  dictationPhase?: HudDictationState;
  working?: boolean;
  size?: HudSizeTokens;
  /** Ordered dot-cluster actions (voice.hubDotActions). */
  dotActions?: HubActionId[];
  /** Captures waiting in the HUD draft (plan 80 follow-up): count only, no preview. */
  draftCount?: number;
  draftLabel?: string | null;
  onHandOffDraft?: () => void;
  onTranslateDraft?: () => void;
  onSpeakDraft?: () => void;
  onRemoveDraft?: () => void;
  draftError?: string | null;
  /** Which way the dot strip opens: `end` = orb right, strip toward screen center. */
  dotDirection?: 'start' | 'end';
  onDictate?: () => void;
  onSendDictation?: () => void;
  /** Stop and keep the transcript (the dock's Stop). */
  onStopDictation?: () => void;
  /** Re-open the mic on the same session (the transcript is kept). */
  onContinueDictation?: () => void;
  /** Discard the session (hold on Stop, or the composer's cancel). */
  onCancelDictation?: () => void;
  onCancelTurn?: () => void;
  onActivateText?: () => void;
  onOpenAssistant?: () => void;
  onOpenDraft?: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onInterruptLive?: () => void;
  onEndLive?: () => void;
}

/**
 * The waiting capture, as a marker beside the text (plan 82 follow-up): an
 * attach icon that opens the capture, plus a **delete** revealed only while the
 * icon is hovered/focused. The four actions themselves are the dock's existing
 * buttons — they act on the capture while it waits (translate/speak OCR it,
 * home hands it to the assistant), so nothing is duplicated.
 */
function AttachMarker({
  label,
  onOpen,
  onRemove,
  error,
  className,
}: {
  label?: string | null;
  onOpen?: () => void;
  onRemove?: () => void;
  /** Last draft action failure: shown, never swallowed. */
  error?: string | null;
  className: string;
}): React.ReactElement {
  return (
    <div className={className} data-testid="speech-hud-draft" data-no-drag>
      <button
        type="button"
        className="sh-attach-open"
        title={label ?? TEXT.HUD_DRAFT_BADGE_SHORT}
        aria-label={label ?? TEXT.HUD_DRAFT_BADGE_SHORT}
        onClick={() => onOpen?.()}
      >
        <Paperclip size={11} aria-hidden="true" />
      </button>
      {error && (
        <span
          className="sh-attach-error"
          role="status"
          data-testid="speech-hud-draft-error"
          title={error}
          aria-label={error}
        >
          <TriangleAlert size={11} aria-hidden="true" />
        </span>
      )}
      <button
        type="button"
        className="sh-attach-delete"
        title={TEXT.HUD_DRAFT_REMOVE}
        aria-label={TEXT.HUD_DRAFT_REMOVE}
        onClick={() => onRemove?.()}
      >
        <Trash2 size={11} aria-hidden="true" />
      </button>
    </div>
  );
}

/** One path per state: the line itself changes shape, so states differ without colour. */
const WAVE_PATHS: Record<SpeechHudVisual, string> = {
  speaking: 'M0 8 C 8 1, 14 1, 20 8 S 32 15, 40 8 S 52 1, 64 8',
  listening: 'M0 8 C 8 2.5, 14 2.5, 20 8 S 32 13.5, 40 8 S 52 2.5, 64 8',
  paused: 'M8 8 H56',
  idle: 'M16 8 H48',
  error: 'M0 8 L8 3 L16 13 L24 3 L32 13 L40 3 L48 13 L56 3 L64 8',
};

function chunkRatio(snapshot: SpeechSnapshot): number {
  const total = Math.max(snapshot.chunkCount, 1);
  const current = Math.min(Math.max(snapshot.chunkIndex + 1, 1), total);
  return current / total;
}

/** Smooth oscillating line (one SVG path) — the shape is legible in reduced motion too. */
function HudWave({ variant, visual }: { variant: 'line' | 'tab'; visual: HudPresentation['visual'] }): React.ReactElement {
  if (variant === 'tab') {
    return (
      <span className="hud-tab-bars" aria-hidden="true" data-visual={visual}>
        {[0, 1, 2].map((bar) => (
          <span key={bar} className="hud-tab-bar" style={{ animationDelay: `${bar * 140}ms` }} />
        ))}
      </span>
    );
  }
  return (
    <span className="hud-wave" aria-hidden="true" data-visual={visual}>
      <svg viewBox="0 0 64 16" preserveAspectRatio="none" focusable="false">
        <path
          className="hud-wave-path"
          d={WAVE_PATHS[visual]}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

const DOCK_ACTION_ICONS: Partial<Record<HubActionId, React.ReactNode>> = {
  'translate-selection': <Languages size={11} aria-hidden="true" />,
  'speak-selection': <Volume2 size={11} aria-hidden="true" />,
  dictate: <Mic size={11} aria-hidden="true" />,
  'open-assistant': <Home size={11} aria-hidden="true" />,
  'hide-hub': <EyeOff size={11} aria-hidden="true" />,
  'capture-screen': <ScanLine size={11} aria-hidden="true" />,
  'live-toggle': <Radio size={11} aria-hidden="true" />,
};

function DockActionButton({
  id,
  active = false,
  small = true,
  visual,
  onActivate,
}: {
  id: HubActionId;
  active?: boolean;
  small?: boolean;
  visual?: SpeechHudVisual;
  onActivate?: () => void;
}): React.ReactElement {
  const label =
    id === 'live-toggle'
      ? active
        ? TEXT.HUB_LIVE_END
        : TEXT.HUB_LIVE_START
      : HUB_ACTIONS[id].label;
  return (
    <button
      type="button"
      className={`${small ? 'hud-ghost hud-ghost--sm hud-dock-action' : 'hud-ghost hud-dock-action'}${
        id === 'live-toggle' ? ' hud-dock-action--live' : ''
      }${active ? ' is-active' : ''}`}
      onClick={() => {
        if (onActivate) {
          onActivate();
          return;
        }
        window.electronAPI?.runQuickHubAction?.(id);
      }}
      aria-label={label}
      aria-pressed={id === 'live-toggle' ? active : undefined}
      data-action={id}
      data-visual={id === 'live-toggle' ? visual : undefined}
      title={label}
    >
      {id === 'live-toggle' && active ? (
        <span className="hud-live-meter" aria-hidden="true">
          <i style={{ ['--bar-scale' as string]: '0.7' }} />
          <i style={{ ['--bar-scale' as string]: '1' }} />
          <i style={{ ['--bar-scale' as string]: '0.82' }} />
        </span>
      ) : (
        DOCK_ACTION_ICONS[id] ?? <span className="hud-action-glyph">•</span>
      )}
    </button>
  );
}

function DictationSendButton({ onClick }: { onClick?: () => void }): React.ReactElement {
  const label = TEXT.HUB_DICTATION_SEND;
  return (
    <button
      type="button"
      className="hud-ghost hud-ghost--sm hud-dock-action"
      data-action="dictate-send"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Send size={13} aria-hidden="true" />
    </button>
  );
}

/** Hold to discard (600 ms): the click commits, so a stray tap never loses words. */
const DICTATION_DISCARD_HOLD_MS = 600;

function StopDictationButton({
  onStop,
  onDiscard,
}: {
  onStop?: () => void;
  onDiscard?: () => void;
}): React.ReactElement {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discarded = useRef(false);
  const clearHold = (): void => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const startHold = (): void => {
    discarded.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      discarded.current = true;
      onDiscard?.();
    }, DICTATION_DISCARD_HOLD_MS);
  };
  return (
    <button
      type="button"
      className="hud-ghost hud-ghost--sm hud-dock-action"
      data-action="dictate-stop"
      onPointerDown={startHold}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onClick={() => {
        clearHold();
        if (discarded.current) {
          discarded.current = false;
          return;
        }
        onStop?.();
      }}
      aria-label={TEXT.HUB_DICTATION_STOP}
      title={TEXT.HUB_DICTATION_STOP_HOLD}
    >
      <Square size={12} aria-hidden="true" />
    </button>
  );
}

function DictateContinueButton({ onClick }: { onClick?: () => void }): React.ReactElement {
  const label = TEXT.HUB_DICTATION_CONTINUE;
  return (
    <button
      type="button"
      className="hud-ghost hud-ghost--sm hud-dock-action"
      data-action="dictate-continue"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Mic size={13} aria-hidden="true" />
    </button>
  );
}

function HubButton({
  small = false,
  side,
  hasMore = false,
}: {
  small?: boolean;
  side?: SpeechHudEdgeSide;
  /** Some enabled actions live only in the grid — the chevron carries a dot. */
  hasMore?: boolean;
}): React.ReactElement {
  const glyph = side === 'right'
    ? <ChevronLeft size={small ? 12 : 14} aria-hidden="true" />
    : side === 'left'
      ? <ChevronRight size={small ? 12 : 14} aria-hidden="true" />
      : side === 'top'
        ? <ChevronDown size={small ? 12 : 14} aria-hidden="true" />
        : side === 'bottom'
          ? <ChevronUp size={small ? 12 : 14} aria-hidden="true" />
          : <LayoutGrid size={small ? 11 : 13} aria-hidden="true" />;
  return (
    <button
      type="button"
      className={small ? 'hud-ghost hud-ghost--sm hud-hub' : 'hud-ghost hud-hub'}
      onClick={() => window.electronAPI?.openHub?.()}
      aria-label={hasMore ? `${TEXT.HUB_POPOVER_TITLE} (${TEXT.HUB_HAS_MORE})` : TEXT.HUB_POPOVER_TITLE}
      title={hasMore ? TEXT.HUB_HAS_MORE : TEXT.HUB_POPOVER_TITLE}
      data-has-more={hasMore ? 'true' : undefined}
    >
      {glyph}
      {hasMore && <span className="hud-hub-dot" aria-hidden="true" />}
    </button>
  );
}

function PauseButton({
  presentation,
  paused,
  active,
  onTogglePause,
  small,
}: {
  presentation: HudPresentation;
  paused: boolean;
  active: boolean;
  onTogglePause: () => void;
  small?: boolean;
}): React.ReactElement {
  const label = paused ? (presentation.labels.resume ?? TEXT.SPEECH_RESUME) : (presentation.labels.pause ?? TEXT.SPEECH_PAUSE);
  return (
    <button type="button" className="hud-ghost hud-playback" onClick={onTogglePause} disabled={!active} aria-label={label} title={label}>
      {paused ? <Play size={small ? 12 : 14} aria-hidden="true" /> : <Pause size={small ? 12 : 14} aria-hidden="true" />}
    </button>
  );
}

function StopButton({
  label,
  active,
  onStop,
  small,
}: {
  label: string;
  active: boolean;
  onStop: () => void;
  small?: boolean;
}): React.ReactElement {
  return (
    <button type="button" className="hud-ghost hud-playback" onClick={onStop} disabled={!active} aria-label={label} title={label}>
      <Square size={small ? 11 : 13} aria-hidden="true" />
    </button>
  );
}

function InterruptButton({ label, onInterrupt, small }: { label: string; onInterrupt: () => void; small?: boolean }): React.ReactElement {
  return (
    <button type="button" className="hud-ghost hud-playback" onClick={onInterrupt} aria-label={label} title={label}>
      <OctagonX size={small ? 11 : 13} aria-hidden="true" />
    </button>
  );
}

const glassClass = (opaque?: boolean): string => (opaque ? 'hud-glass hud-glass--opaque' : 'hud-glass');

/** Right-click opens the native HUD menu (mini / dock tab / orb). */
function hudMenu(event: React.MouseEvent): void {
  event.preventDefault();
  void window.electronAPI?.openSpeechHudMenu?.();
}

function menuHint(label: string): string {
  return `${label} · ${TEXT.SPEECH_HUD_MENU_HINT}`;
}

function openAssistantHud(): void {
  void window.electronAPI?.openHudAssistant?.();
}

function liveCardLabel(visual: HudPresentation['visual'], reason?: string): string {
  switch (visual) {
    case 'listening':
      return TEXT.LIVE_HUD_LISTENING;
    case 'speaking':
      return TEXT.SPEECH_SPEAKING;
    case 'paused':
      return reason === 'approval' ? TEXT.LIVE_HUD_APPROVAL : TEXT.SPEECH_PAUSED;
    case 'error':
      return TEXT.LIVE_HUD_ERROR;
    default:
      return TEXT.LIVE_HUD_THINKING;
  }
}

function OpenAssistantButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      className="hud-ghost"
      onClick={onOpen}
      aria-label={TEXT.SPEECH_HUD_OPEN_ASSISTANT}
      title={TEXT.SPEECH_HUD_OPEN_ASSISTANT}
    >
      <Home size={13} aria-hidden="true" />
    </button>
  );
}

/** The card style — the textual HUD; live swaps in state + captions. */
export function SpeechHudCard({
  snapshot,
  presentation,
  flash,
  opaque,
  liveTranscript,
  liveCaption,
  liveReason,
  controls,
  onOpenAssistant,
  draftCount = 0,
  draftLabel,
  onOpenDraft,
  onHandOffDraft,
  onRemoveDraft,
  draftError,
  onTogglePause,
  onStop,
  onInterruptLive,
  onEndLive,
}: {
  snapshot: SpeechSnapshot;
  presentation: HudPresentation;
  flash: string | null;
  opaque?: boolean;
  liveTranscript?: string | null;
  liveCaption?: string | null;
  liveReason?: string;
  controls?: 'auto' | 'always';
  onOpenAssistant?: () => void;
  /** A HUD capture is waiting: the card shows it instead of the state line. */
  draftCount?: number;
  draftLabel?: string | null;
  onOpenDraft?: () => void;
  onHandOffDraft?: () => void;
  onRemoveDraft?: () => void;
  draftError?: string | null;
  onTogglePause: () => void;
  onStop: () => void;
  onInterruptLive?: () => void;
  onEndLive?: () => void;
}): React.ReactElement {
  const drag = useHudDrag();
  const live = presentation.mode === 'live';
  const paused = snapshot.state === 'paused';
  const active = snapshot.state !== 'idle';
  const total = Math.max(snapshot.chunkCount, 1);
  const current = Math.min(Math.max(snapshot.chunkIndex + 1, 1), total);
  const progress = interpolate(TEXT.SPEECH_PROGRESS, { current, total });
  const stateLine = live ? liveCardLabel(presentation.visual, liveReason) : null;
  const line = live ? stateLine : flash ?? (snapshot.chunkText || TEXT.SPEECH_PREPARING);
  const caption = live ? plainTextFromMarkdown(liveCaption || liveTranscript || '') || null : null;
  const bodyPointerDown = useRef(false);
  const bodyClickable = presentation.click !== 'none';
  const bodyLabel =
    presentation.click === 'pause'
      ? TEXT.SPEECH_PAUSE
      : presentation.click === 'resume'
        ? TEXT.SPEECH_RESUME
        : presentation.click === 'interrupt-live'
          ? TEXT.SPEECH_LIVE_INTERRUPT
          : TEXT.SPEECH_HUD_ARIA;

  const bodyClick = (): void => {
    if (drag.consumeDrag()) {
      return;
    }
    switch (presentation.click) {
      case 'pause':
      case 'resume':
        onTogglePause();
        return;
      case 'interrupt-live':
        onInterruptLive?.();
        return;
      case 'end-live':
        onEndLive?.();
        return;
      default:
    }
  };

  const body = (
    <>
      <div className="sh-status" role="status" aria-live="polite" aria-atomic="true">
        <span className="sh-text" title={line ?? undefined}>
          {line}
        </span>
        {!live && <span className="sh-progress">{progress}</span>}
      </div>
      {live ? (
        caption ? (
          <span className="sh-live-caption" title={caption}>
            {caption}
          </span>
        ) : null
      ) : (
        <div
          className="sh-track"
          aria-hidden="true"
          data-testid="speech-hud-track"
          data-progress={String(current / total)}
        >
          <span className="sh-fill" style={{ width: `${(current / total) * 100}%` }} />
        </div>
      )}
    </>
  );

  return (
    <div
      className={`sh-card ${glassClass(opaque)}`}
      role="group"
      aria-label={TEXT.SPEECH_HUD_ARIA}
      data-state={snapshot.state}
      data-mode={presentation.mode}
      data-visual={presentation.visual}
      data-opaque={opaque ? 'true' : 'false'}
      data-playback-active={presentation.mode === 'live' ? 'true' : snapshot.state !== 'idle' ? 'true' : 'false'}
      data-controls={controls ?? 'auto'}
      onContextMenu={hudMenu}
      {...drag.dragProps}
      onPointerDown={(event) => {
        bodyPointerDown.current = Boolean((event.target as HTMLElement).closest?.('.sh-body'));
        drag.dragProps.onPointerDown(event);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || !bodyPointerDown.current) {
          return;
        }
        bodyPointerDown.current = false;
        bodyClick();
      }}
    >
      <HudWave variant="line" visual={presentation.visual} />
      {draftCount > 0 ? (
        <div className="sh-body sh-body--draft" data-testid="speech-hud-body">
          <AttachMarker
            className="sh-card-attach"
            label={draftLabel}
            onOpen={onOpenDraft}
            onRemove={onRemoveDraft}
            error={draftError}
          />
        </div>
      ) : bodyClickable ? (
        <button
          type="button"
          className="sh-body"
          data-testid="speech-hud-body"
          aria-label={bodyLabel}
          title={menuHint(bodyLabel)}
          onClick={bodyClick}
        >
          {body}
        </button>
      ) : (
        <div className="sh-body" data-testid="speech-hud-body">
          {body}
        </div>
      )}
      <div className="sh-actions">
        {live ? (
          <>
            <InterruptButton label={presentation.labels.body} onInterrupt={() => onInterruptLive?.()} />
            <StopButton
              label={presentation.labels.stop ?? TEXT.SPEECH_LIVE_END}
              active
              onStop={() => onEndLive?.()}
            />
          </>
        ) : (
          active && (
            <>
              <PauseButton presentation={presentation} paused={paused} active={active} onTogglePause={onTogglePause} />
              <StopButton label={presentation.labels.stop ?? TEXT.SPEECH_STOP} active={active} onStop={onStop} />
            </>
          )
        )}
        <OpenAssistantButton
          onOpen={
            draftCount > 0 && onHandOffDraft
              ? () => onHandOffDraft()
              : () => (onOpenAssistant ? onOpenAssistant() : openAssistantHud())
          }
        />
      </div>
    </div>
  );
}

/** Orb: presence dot with a radial core, ring and breathing halo. Click stops/ends. */
export function SpeechHudDot({
  presentation,
  flash,
  opaque,
  actions,
  dictating,
  dictationPhase,
  direction = 'end',
  micLevel,
  onDictate,
  onSendDictation,
  onStopDictation,
  onContinueDictation,
  onCancelDictation,
  onStop,
  onInterruptLive,
  onEndLive,
}: {
  presentation: HudPresentation;
  flash: string | null;
  opaque?: boolean;
  /** Ordered dot-cluster action ids, resolved for the current state. */
  actions?: HubActionId[];
  dictating?: boolean;
  dictationPhase?: HudDictationState;
  direction?: 'start' | 'end';
  micLevel?: number;
  onDictate?: () => void;
  onSendDictation?: () => void;
  onStopDictation?: () => void;
  onContinueDictation?: () => void;
  onCancelDictation?: () => void;
  onStop: () => void;
  onInterruptLive?: () => void;
  onEndLive?: () => void;
}): React.ReactElement {
  const drag = useHudDrag();
  const click = (): void => {
    if (drag.consumeDrag()) {
      return;
    }
    if (dictating) {
      return;
    }
    switch (presentation.click) {
      case 'stop-speech':
        onStop();
        return;
      case 'end-live':
        onEndLive?.();
        return;
      case 'interrupt-live':
        onInterruptLive?.();
        return;
      default:
    }
  };

  return (
    <div
      className="sh-orb-wrap"
      data-testid="speech-hud-dot-wrap"
      data-dir={direction}
      data-dictating={dictating ? 'true' : 'false'}
      data-dictation={dictationPhase ?? undefined}
      style={{ ['--hud-dot-level' as string]: String(micLevel ?? 0) }}
    >
      <button
        type="button"
        className={`sh-orb ${opaque ? 'hud-glass--opaque' : ''}`}
        data-testid="speech-hud-dot"
        data-mode={presentation.mode}
        data-visual={presentation.visual}
        data-flash={flash ? 'true' : 'false'}
        data-opaque={opaque ? 'true' : 'false'}
        aria-label={presentation.labels.body}
        title={menuHint(presentation.labels.body)}
        onClick={click}
        onContextMenu={hudMenu}
        {...drag.dragProps}
      >
        <span className="sh-orb-core" aria-hidden="true" />
      </button>
      <div className="sh-orb-actions" role="group" aria-label={TEXT.HUB_DOT_ACTIONS_ARIA}>
        {(actions ?? []).map((id) => (
          <DockActionButton key={id} id={id} />
        ))}
        {dictating ? (
          <>
            <DictationSendButton onClick={onSendDictation} />
            {dictationPhase === 'ready' ? (
              <DictateContinueButton onClick={onContinueDictation} />
            ) : (
              <StopDictationButton onStop={onStopDictation} onDiscard={onCancelDictation} />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Dock tab: flush half-pill with vertical bars, glowing edge fill and inner controls. */
export function SpeechHudEdge({
  snapshot,
  presentation,
  side,
  flash,
  opaque,
  dock,
  dockText,
  busy,
  micLevel,
  selection,
  dictating,
  dictationPhase,
  working,
  textScale,
  draftCount = 0,
  draftLabel,
  onHandOffDraft,
  onTranslateDraft,
  onSpeakDraft,
  onRemoveDraft,
  draftError,
  onDictate,
  onSendDictation,
  onStopDictation,
  onContinueDictation,
  onCancelDictation,
  onCancelTurn,
  onActivateText,
  onOpenAssistant,
  onOpenDraft,
  onTogglePause,
  onStop,
  onInterruptLive,
  onEndLive,
}: {
  snapshot: SpeechSnapshot;
  presentation: HudPresentation;
  side: SpeechHudEdgeSide;
  flash: string | null;
  opaque?: boolean;
  dock?: SpeechHudDock;
  dockText?: string;
  busy?: boolean;
  micLevel?: number;
  selection?: boolean;
  dictating?: boolean;
  dictationPhase?: HudDictationState;
  working?: boolean;
  textScale?: number;
  /** A HUD capture is waiting: the text area shows it instead of the dock text. */
  draftCount?: number;
  draftLabel?: string | null;
  onHandOffDraft?: () => void;
  onTranslateDraft?: () => void;
  onSpeakDraft?: () => void;
  onRemoveDraft?: () => void;
  draftError?: string | null;
  onDictate?: () => void;
  onSendDictation?: () => void;
  /** Stop and keep the transcript (the dock's Stop). */
  onStopDictation?: () => void;
  /** Re-open the mic on the same session (the transcript is kept). */
  onContinueDictation?: () => void;
  /** Discard the session (hold on Stop, or the composer's cancel). */
  onCancelDictation?: () => void;
  onCancelTurn?: () => void;
  onActivateText?: () => void;
  onOpenAssistant?: () => void;
  onOpenDraft?: () => void;
  onTogglePause: () => void;
  onStop: () => void;
  onInterruptLive?: () => void;
  onEndLive?: () => void;
}): React.ReactElement {
  const drag = useHudDrag();
  const live = presentation.mode === 'live';
  const paused = snapshot.state === 'paused';
  const active = live || snapshot.state !== 'idle';
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [measuredContent, setMeasuredContent] = useState<SpeechHudTextContent | null>(null);
  useLayoutEffect(() => {
    if (!dock?.text || !dockText?.trim() || !measureRef.current) {
      setMeasuredContent(null);
      return;
    }
    const element = measureRef.current;
    const height = element.getBoundingClientRect().height;
    if (height <= 0) {
      setMeasuredContent(null);
      return;
    }
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 14;
    const lines = Math.max(1, Math.min(3, Math.round(height / lineHeight)));
    setMeasuredContent(lines > 1 ? 'multi' : 'single');
  }, [dock?.text, dockText, textScale]);
  const dockContext = {
    surface: 'dock' as const,
    audio: snapshot.state !== 'idle' && !live,
    live,
    selection: selection === true,
    busy: busy === true,
    dictating: dictating === true,
    working: working === true,
    stop: dictating === true || (!live && active),
  };
  const dockControls = resolveHubControls(dockContext);
  const dockLayout = dockRow(dockControls, dockContext);
  // A waiting capture takes over the dock's text line (plan 82 follow-up): it is
  // ordinary dock text as far as layout is concerned, which is the one thing
  // that is known to fit the face and stay clear of the action cluster.
  const hasDraft = draftCount > 0;
  const draftAction = (id: HubActionId): (() => void) | undefined => {
    if (!hasDraft) {
      return undefined;
    }
    if (id === 'translate-selection') {
      return () => onTranslateDraft?.();
    }
    if (id === 'speak-selection') {
      return () => onSpeakDraft?.();
    }
    if (id === 'open-assistant') {
      return () => onHandOffDraft?.();
    }
    return undefined;
  };
  // A running dictation with no interim text still says it is listening.
  const listening = dictating === true && !(dockText ?? '').trim();
  // The transcript/dock text is never suppressed by a waiting attachment: the
  // marker shares the band with it (plan 82 follow-up).
  const displayText = listening ? TEXT.HUD_DICTATION_LISTENING : plainTextFromMarkdown(dockText ?? '');
  // The transcript and a waiting capture use the same text face as a reply:
  // forcing `single` for dictation or a draft clamped the transcript to one
  // ellipsised line. `single` is the wordless line (Listening…/the marker's
  // face), which still needs more room than the collapsed strip.
  const hasDockText = !!dockText?.trim();
  const content = listening || (hasDraft && !hasDockText)
    ? 'single'
    : dock?.text || hasDraft
      ? (hasDockText
          ? measuredContent ?? speechDockTextContent(dockText)
          : 'empty')
      : undefined;
  const face = content ? speechEdgeFaceSize(content, dock?.size) : null;
  const geometry = face
    ? speechKnobGeometryFor(side, face.width, face.height)
    : speechKnobGeometry(side, dock);
  const wide = dock?.text === true || hasDraft;
  const hasText = !!displayText.trim() && (listening || content !== 'empty') && (wide || hasDraft);
  const hasTextAction = hasText && typeof onActivateText === 'function';
  // A result is a result whether or not dictation is still running: the tools
  // must not hide behind `dictating` (that read as "nothing is shown").
  const showResultTools = hasText && !!displayText.trim();
  const bodyLabel = hasTextAction ? TEXT.HUB_OPEN_RESULT : presentation.labels.body;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyDockText = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (!displayText) {
      return;
    }
    void window.electronAPI?.writeToClipboard?.(displayText).then((ok) => {
      if (!ok) {
        return;
      }
      setCopied(true);
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null;
        setCopied(false);
      }, 1_200);
    });
  };
  const openExpandedAssistant = (): void => {
    if (onOpenAssistant) {
      onOpenAssistant();
      return;
    }
    openAssistantHud();
  };
  const speakDockText = (event: React.MouseEvent): void => {
    event.stopPropagation();
    const speakable = speechTextFromMarkdown(displayText);
    if (!speakable) {
      return;
    }
    void window.electronAPI?.speakText?.({ text: speakable, source: 'reply' }).catch(() => undefined);
  };
  const bodyClick = (): void => {
    if (drag.consumeDrag()) {
      return;
    }
    if (hasTextAction) {
      onActivateText?.();
      return;
    }
    if (presentation.click === 'pause' || presentation.click === 'resume') {
      onTogglePause();
      return;
    }
    if (presentation.click === 'interrupt-live') {
      onInterruptLive?.();
    }
  };

  return (
    <div
      className="sh-knob"
      role="group"
      aria-label={TEXT.SPEECH_HUD_ARIA}
      data-side={side}
      data-mode={presentation.mode}
      data-visual={presentation.visual}
      data-flash={flash ? 'true' : 'false'}
      data-opaque={opaque ? 'true' : 'false'}
      data-wide={wide ? 'true' : 'false'}
      data-hub-busy={busy ? 'true' : 'false'}
      data-dictating={dictating ? 'true' : 'false'}
      data-dictation={dictationPhase ?? undefined}
      data-content={content ?? 'compact'}
      data-mic-level={micLevel !== undefined ? String(micLevel) : undefined}
      data-text={hasText ? 'true' : 'false'}
      data-attach={hasDraft ? 'true' : 'false'}
      data-tools={showResultTools ? 'true' : 'false'}
      style={{
        width: geometry.width,
        height: geometry.height,
        ['--hud-radius' as string]: geometry.borderRadius,
        ['--hud-mic-level' as string]: String(micLevel ?? 0),
      }}
      onContextMenu={hudMenu}
    >
      <div
        className={`sh-knob-face ${glassClass(opaque)}`}
        style={{ borderRadius: geometry.borderRadius }}
      >
        <button
          type="button"
          className="sh-knob-body"
          data-testid="speech-hud-body"
          aria-label={bodyLabel}
          title={menuHint(bodyLabel)}
          onClick={bodyClick}
          disabled={busy || (draftCount === 0 && presentation.click === 'none' && !hasTextAction)}
          {...drag.dragProps}
        >
          {!hasText && <HudWave variant="tab" visual={presentation.visual} />}
          {hasText && (
            <span className="sh-knob-text" title={displayText}>
              {displayText}
            </span>
          )}
        </button>
        {hasDraft && (
          <AttachMarker
            className="sh-knob-attach"
            label={draftLabel}
            onOpen={onOpenDraft}
            onRemove={onRemoveDraft}
            error={draftError}
          />
        )}
        <span
          className="sh-knob-fill"
          aria-hidden="true"
          data-testid="speech-hud-track"
          data-visible={presentation.showProgress ? 'true' : 'false'}
          style={
            side === 'left' || side === 'right'
              ? { height: `${chunkRatio(snapshot) * 100}%` }
              : { width: `${chunkRatio(snapshot) * 100}%` }
          }
        />
        <div className="sh-actions sh-knob-actions">
          {dockLayout.visible.map((control) => {
            switch (control.id) {
              case 'hub':
                return <HubButton key={control.id} small side={side} hasMore={dockLayout.overflow.length > 0} />;
              case 'live-toggle':
                return (
                  <DockActionButton
                    key={control.id}
                    id="live-toggle"
                    active={live}
                    small
                    visual={presentation.visual}
                  />
                );
              case 'dictate':
                return (
                  <DockActionButton
                    key={control.id}
                    id="dictate"
                    small
                    onActivate={onDictate}
                  />
                );
              case 'open-assistant':
                return (
                  <DockActionButton
                    key={control.id}
                    id="open-assistant"
                    small
                    onActivate={draftAction(control.id) ?? (hasText ? openExpandedAssistant : undefined)}
                  />
                );
              case 'dictate-send':
                return <DictationSendButton key={control.id} onClick={onSendDictation} />;
              case 'translate-selection':
              case 'speak-selection':
              case 'capture-screen':
                return (
                  <DockActionButton key={control.id} id={control.id} small onActivate={draftAction(control.id)} />
                );
              case 'pause':
                return (
                  <PauseButton
                    key={control.id}
                    presentation={presentation}
                    paused={paused}
                    active={active}
                    onTogglePause={onTogglePause}
                    small
                  />
                );
              case 'stop':
                // A stopped dictation keeps its words: the same slot becomes
                // Continue (re-open the mic and append), never a discard.
                if (dictating && dictationPhase === 'ready') {
                  return (
                    <DictateContinueButton key={control.id} onClick={onContinueDictation} />
                  );
                }
                if (dictating) {
                  return (
                    <StopDictationButton
                      key={control.id}
                      onStop={onStopDictation}
                      onDiscard={onCancelDictation}
                    />
                  );
                }
                return (
                  <StopButton
                    key={control.id}
                    label={TEXT.SPEECH_STOP}
                    active={active}
                    onStop={onStop}
                    small
                  />
                );
              case 'stop-turn':
                return (
                  <StopButton
                    key={control.id}
                    label={TEXT.HUB_TURN_STOP}
                    active
                    onStop={() => onCancelTurn?.()}
                    small
                  />
                );
              case 'interrupt':
                return (
                  <InterruptButton
                    key={control.id}
                    label={presentation.labels.body}
                    onInterrupt={() => onInterruptLive?.()}
                    small
                  />
                );
              case 'end-live':
                return (
                  <StopButton
                    key={control.id}
                    label={TEXT.HUB_LIVE_END}
                    active
                    onStop={() => onEndLive?.()}
                    small
                  />
                );
              default:
                return null;
            }
          })}
        </div>
      </div>
      {showResultTools && (
        <span className="sh-knob-tools" role="group" aria-label={TEXT.HUD_RESULT_TOOLS}>
          <button
            type="button"
            className="sh-knob-copy sh-knob-tool"
            aria-label={TEXT.HUB_RESULT_COPY}
            title={TEXT.HUB_RESULT_COPY}
            onClick={copyDockText}
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="sh-knob-speak sh-knob-tool"
            aria-label={TEXT.HUD_RESULT_SPEAK}
            title={TEXT.HUD_RESULT_SPEAK}
            onClick={speakDockText}
          >
            <Volume2 size={12} aria-hidden="true" />
          </button>
        </span>
      )}
      {wide && dockText?.trim() && (
        <span ref={measureRef} className="sh-knob-measure" aria-hidden="true">
          {dockText}
        </span>
      )}
      <span className="hud-ring" aria-hidden="true" />
    </div>
  );
}

/** Style dispatcher: one state machine, four presentations. */
export function SpeechHud(props: SpeechHudProps): React.ReactElement {
  const style = props.style ?? 'card';
  const side = props.edgeSide ?? 'right';
  const presentation = hudPresentation({ style, live: props.live, speech: props.snapshot });
  const flash = useHudFlash(props.snapshot.lastError, props.snapshot.utteranceId);
  const size = props.size ?? HUD_SIZE_TOKENS.comfort;
  const box = speechHudBox(style, side, props.dock);
  const draftCount = props.draftCount ?? 0;
  const stage = (hud: React.ReactElement): React.ReactElement => (
    <div
      className="hud-stage"
      role="region"
      aria-label={TEXT.HUD_LANDMARK}
      data-style={style}
      data-side={style === 'edge' ? side : undefined}
      data-preset={props.preset ?? 'pulse'}
      data-motion={props.motion === false ? 'off' : 'on'}
      style={{
        width: box.width,
        height: box.height,
        padding: `${box.pad.top}px ${box.pad.right}px ${box.pad.bottom}px ${box.pad.left}px`,
        ['--hud-text-scale' as string]: String(props.textScale ?? size.textScale),
        ['--hud-control-size' as string]: `${size.controlSize}px`,
        ['--hud-control-gap' as string]: `${size.gap}px`,
        ['--hud-control-radius' as string]: '9px',
        ['--hud-mic-level' as string]: String(props.micLevel ?? 0),
      }}
    >
      {hud}
    </div>
  );

  if (style === 'dot') {
    const live = presentation.mode === 'live';
    const resolved = resolveHubControls({
      surface: 'dot',
      audio: props.snapshot.state !== 'idle' && !live,
      live,
      selection: props.selection === true,
      busy: props.busy === true,
      dictating: props.dictating === true,
      working: props.working === true,
    })
      .map((control) => control.id)
      .filter((id): id is HubActionId => (HUB_ACTION_IDS as readonly string[]).includes(id));
    const order = props.dotActions ?? [];
    const actions = order.filter((id) => resolved.includes(id));
    return stage(
      <SpeechHudDot
        presentation={presentation}
        flash={flash}
        opaque={props.opaque}
        actions={actions}
        dictating={props.dictating}
        dictationPhase={props.dictationPhase}
        direction={props.dotDirection}
        micLevel={props.micLevel}
        onSendDictation={props.onSendDictation}
        onStopDictation={props.onStopDictation}
        onContinueDictation={props.onContinueDictation}
        onCancelDictation={props.onCancelDictation}
        onStop={props.onStop}
        onInterruptLive={props.onInterruptLive}
        onEndLive={props.onEndLive}
      />
    );
  }
  if (style === 'edge') {
    return stage(
      <SpeechHudEdge
        snapshot={props.snapshot}
        presentation={presentation}
        side={side}
        flash={flash}
        opaque={props.opaque}
        dock={props.dock}
        dockText={props.dockText}
        onActivateText={props.onActivateText}
        busy={props.busy}
        micLevel={props.micLevel}
        selection={props.selection}
        dictating={props.dictating}
        dictationPhase={props.dictationPhase}
        working={props.working}
        textScale={props.textScale}
        draftCount={props.draftCount}
        draftLabel={props.draftLabel}
        onOpenDraft={props.onOpenDraft}
        onHandOffDraft={props.onHandOffDraft}
        onTranslateDraft={props.onTranslateDraft}
        onSpeakDraft={props.onSpeakDraft}
        onRemoveDraft={props.onRemoveDraft}
        draftError={props.draftError}
        onOpenAssistant={props.onOpenAssistant}
        onDictate={props.onDictate}
        onSendDictation={props.onSendDictation}
        onStopDictation={props.onStopDictation}
        onContinueDictation={props.onContinueDictation}
        onCancelDictation={props.onCancelDictation}
        onCancelTurn={props.onCancelTurn}
        onTogglePause={props.onTogglePause}
        onStop={props.onStop}
        onInterruptLive={props.onInterruptLive}
        onEndLive={props.onEndLive}
      />
    );
  }
  return stage(
    <SpeechHudCard
      snapshot={props.snapshot}
      presentation={presentation}
      flash={flash}
      opaque={props.opaque}
      liveTranscript={props.liveTranscript}
      liveCaption={props.liveCaption}
      liveReason={props.live?.reason}
      onOpenAssistant={props.onOpenAssistant}
      draftCount={props.draftCount}
      draftLabel={props.draftLabel}
      onOpenDraft={props.onOpenDraft}
      onHandOffDraft={props.onHandOffDraft}
      onRemoveDraft={props.onRemoveDraft}
      draftError={props.draftError}
      onTogglePause={props.onTogglePause}
      onStop={props.onStop}
      onInterruptLive={props.onInterruptLive}
      onEndLive={props.onEndLive}
    />
  );
}
