import { isLiveActive, type LiveSnapshot, type LiveState } from '@shared/live';
import type { SpeechSnapshot } from '@shared/speech';
import { TEXT } from '@shared/constants/text';

/** The HUD style family (plan 58 addendum): textless presentations of one state machine. */
export const SPEECH_HUD_STYLES = ['card', 'edge', 'dot'] as const;

export type SpeechHudStyle = (typeof SPEECH_HUD_STYLES)[number];

export const SPEECH_HUD_EDGE_SIDES = ['left', 'right', 'top', 'bottom'] as const;

export type SpeechHudEdgeSide = (typeof SPEECH_HUD_EDGE_SIDES)[number];

/** The visible shape per style (the window adds glow padding around it). */
export const SPEECH_HUD_SHAPES: Record<SpeechHudStyle, { width: number; height: number }> = {
  card: { width: 400, height: 72 },
  edge: { width: 30, height: 68 },
  dot: { width: 28, height: 28 },
};

/** Space reserved around the shape so the outer glow is never clipped. */
export const HUD_GLOW_PAD = 10;

/** The orb/dot keeps this distance from the work-area edges at ratio 0/1. */
export const HUD_DOT_SAFE_MARGIN = 12;

/**
 * The dot's hover cluster (knob-style glass buttons beside the orb). The
 * window envelope always hosts the maximum strip so hover never resizes the
 * frameless window on X11.
 */
export const HUD_DOT_STRIP = {
  buttonSize: 22,
  gap: 6,
  maxButtons: 3,
} as const;

export function dotStripWidth(buttons: number = HUD_DOT_STRIP.maxButtons): number {
  const count = Math.max(0, Math.min(HUD_DOT_STRIP.maxButtons, buttons));
  if (count === 0) {
    return 0;
  }
  return count * HUD_DOT_STRIP.buttonSize + (count - 1) * HUD_DOT_STRIP.gap;
}

/** A 2px reveal on the flat side of a top/bottom dock keeps its glow alive. */
export const HUD_EDGE_REVEAL = 2;

export interface SpeechHudBox {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
}

/** The visible text areas inside the edge face. */
export type SpeechHudTextContent = 'empty' | 'single' | 'multi';

export const HUD_SIZE_PRESETS = ['compact', 'comfort', 'large'] as const;
export type HudSizePreset = (typeof HUD_SIZE_PRESETS)[number];
export const HUD_SIZE_OPTIONS = [...HUD_SIZE_PRESETS, 'custom'] as const;
export type HudSizeMode = (typeof HUD_SIZE_OPTIONS)[number];
export const HUD_DEFAULT_SIZE_PRESET: HudSizePreset = 'comfort';

export interface HudCustomSize {
  faceWidth: number;
  controlSize: number;
  textSize: number;
}

export interface HudSizeTokens {
  mode: HudSizeMode;
  faceWidth: number;
  controlSize: number;
  textSize: number;
  gap: number;
  textScale: number;
  faceHeights: Record<SpeechHudTextContent, number>;
  window: { width: number; height: number };
}

export const HUD_CUSTOM_LIMITS = {
  faceWidth: { min: 204, max: 280, step: 2 },
  controlSize: { min: 22, max: 30, step: 1 },
  textSize: { min: 11, max: 14, step: 0.5 },
} as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function buildHudSizeTokens(
  mode: HudSizeMode,
  faceWidth: number,
  controlSize: number,
  textSize: number,
  gap: number
): HudSizeTokens {
  const line = Math.ceil(textSize * 1.28);
  const strip = controlSize + 1;
  const empty = controlSize + 3;
  const single = line + strip + 9;
  const multi = line * 3 + strip + 6;
  return {
    mode,
    faceWidth,
    controlSize,
    textSize,
    gap,
    textScale: Number((textSize / 11).toFixed(3)),
    faceHeights: { empty, single, multi },
    window: {
      width: faceWidth + HUD_GLOW_PAD * 2,
      height: multi + HUD_GLOW_PAD * 2,
    },
  };
}

export const HUD_SIZE_TOKENS: Record<HudSizePreset, HudSizeTokens> = {
  compact: buildHudSizeTokens('compact', 204, 22, 11, 2),
  comfort: buildHudSizeTokens('comfort', 220, 22, 12, 1),
  large: buildHudSizeTokens('large', 240, 26, 13, 3),
};

export function clampHudCustomSize(custom?: Partial<HudCustomSize>): HudCustomSize {
  const controlSize = clamp(
    Math.round(custom?.controlSize ?? HUD_SIZE_TOKENS.comfort.controlSize),
    HUD_CUSTOM_LIMITS.controlSize.min,
    HUD_CUSTOM_LIMITS.controlSize.max
  );
  const gap = controlSize >= 26 ? 3 : 2;
  const minFaceWidth = 7 * controlSize + 6 * gap + 32;
  return {
    faceWidth: clamp(
      Math.round(custom?.faceWidth ?? HUD_SIZE_TOKENS.comfort.faceWidth),
      Math.max(HUD_CUSTOM_LIMITS.faceWidth.min, minFaceWidth),
      HUD_CUSTOM_LIMITS.faceWidth.max
    ),
    controlSize,
    textSize: clamp(
      Math.round((custom?.textSize ?? HUD_SIZE_TOKENS.comfort.textSize) * 2) / 2,
      HUD_CUSTOM_LIMITS.textSize.min,
      HUD_CUSTOM_LIMITS.textSize.max
    ),
  };
}

export function hudSizeTokens(
  mode: HudSizeMode = HUD_DEFAULT_SIZE_PRESET,
  custom?: Partial<HudCustomSize>
): HudSizeTokens {
  if (mode === 'custom') {
    const size = clampHudCustomSize(custom);
    return buildHudSizeTokens('custom', size.faceWidth, size.controlSize, size.textSize, size.controlSize >= 26 ? 3 : 2);
  }
  return HUD_SIZE_TOKENS[mode] ?? HUD_SIZE_TOKENS[HUD_DEFAULT_SIZE_PRESET];
}

export function speechDockTextContent(text: string | undefined): SpeechHudTextContent {
  const value = text?.trim() ?? '';
  if (!value) {
    return 'empty';
  }
  return value.length > 30 ? 'multi' : 'single';
}

export function speechEdgeFaceSize(
  content: SpeechHudTextContent,
  size: HudSizeTokens = HUD_SIZE_TOKENS[HUD_DEFAULT_SIZE_PRESET]
): { width: number; height: number } {
  return { width: size.faceWidth, height: size.faceHeights[content] };
}

/** Wide dock (plan 65): text mode widens the tab toward the desktop. */
export interface SpeechHudDock {
  text: boolean;
  width?: number;
  size?: HudSizeTokens;
}

export function edgeDockWidth(dock?: SpeechHudDock): number {
  if (!dock?.text || dock.width === 30) {
    return 30;
  }
  return dock.size?.faceWidth ?? HUD_SIZE_TOKENS[HUD_DEFAULT_SIZE_PRESET].faceWidth;
}

/** Shape of the edge tab: compact 30×68, wide 96/128×68. */
export function speechEdgeShape(
  edgeSide: SpeechHudEdgeSide,
  dock?: SpeechHudDock
): { width: number; height: number } {
  const width = edgeDockWidth(dock);
  const textHeight = dock?.size?.faceHeights.multi ?? HUD_SIZE_TOKENS[HUD_DEFAULT_SIZE_PRESET].faceHeights.multi;
  if (isVerticalEdge(edgeSide)) {
    return { width, height: width > 30 ? textHeight : SPEECH_HUD_SHAPES.edge.height };
  }
  return width > 30
    ? { width, height: textHeight }
    : { width: SPEECH_HUD_SHAPES.edge.height, height: SPEECH_HUD_SHAPES.edge.width };
}

/**
 * Window box per style: the shape plus the padding that hosts its glow.
 * The knob rotates for a top/bottom dock (68×30), so the box rotates too —
 * it must be 68 + side pads wide, never the vertical 30. The knob's docked
 * side carries no padding (it hugs the screen edge); a top/bottom dock keeps
 * the 2 px reveal.
 */
export function speechHudBox(
  style: SpeechHudStyle,
  edgeSide: SpeechHudEdgeSide = 'right',
  dock?: SpeechHudDock
): SpeechHudBox {
  const shape = style === 'edge' ? speechEdgeShape(edgeSide, dock) : SPEECH_HUD_SHAPES[style];
  if (style === 'edge') {
    const size = dock?.size ?? HUD_SIZE_TOKENS[HUD_DEFAULT_SIZE_PRESET];
    if (isVerticalEdge(edgeSide)) {
      const padLeft = edgeSide === 'left' ? 0 : HUD_GLOW_PAD;
      const padRight = edgeSide === 'right' ? 0 : HUD_GLOW_PAD;
      return {
        width: dock?.text ? size.window.width : shape.width + padLeft + padRight,
        height: dock?.text ? size.window.height : shape.height + HUD_GLOW_PAD * 2,
        pad: { top: HUD_GLOW_PAD, right: padRight, bottom: HUD_GLOW_PAD, left: padLeft },
      };
    }
    const padTop = edgeSide === 'top' ? HUD_EDGE_REVEAL : HUD_GLOW_PAD;
    const padBottom = edgeSide === 'bottom' ? HUD_EDGE_REVEAL : HUD_GLOW_PAD;
    return {
      width: dock?.text ? size.window.width : shape.width + HUD_GLOW_PAD * 2,
      height: dock?.text ? size.window.height : shape.height + padTop + padBottom,
      pad: { top: padTop, right: HUD_GLOW_PAD, bottom: padBottom, left: HUD_GLOW_PAD },
    };
  }
  if (style === 'dot') {
    return {
      width: shape.width + HUD_DOT_STRIP.gap + dotStripWidth() + HUD_GLOW_PAD * 2,
      height: shape.height + HUD_GLOW_PAD * 2,
      pad: { top: HUD_GLOW_PAD, right: HUD_GLOW_PAD, bottom: HUD_GLOW_PAD, left: HUD_GLOW_PAD },
    };
  }
  return {
    width: shape.width + HUD_GLOW_PAD * 2,
    height: shape.height + HUD_GLOW_PAD * 2,
    pad: { top: HUD_GLOW_PAD, right: HUD_GLOW_PAD, bottom: HUD_GLOW_PAD, left: HUD_GLOW_PAD },
  };
}

export function speechHudWindowSize(
  style: SpeechHudStyle,
  edgeSide: SpeechHudEdgeSide = 'right',
  dock?: SpeechHudDock
): { width: number; height: number } {
  const box = speechHudBox(style, edgeSide, dock);
  return { width: box.width, height: box.height };
}

export const SPEECH_HUD_MIN_CLICKABLE = 16;

export function isVerticalEdge(side: SpeechHudEdgeSide): boolean {
  return side === 'left' || side === 'right';
}

export interface SpeechKnobGeometry {
  width: number;
  height: number;
  /** Exact half-pill radii (CSS order: top-left top-right bottom-right bottom-left). */
  borderRadius: string;
}

/**
 * The half-pill: a straight face on the docked edge and a semicircular cap on
 * the desktop-facing side. `999px` over-radius scaling turned a 34 px knob
 * into an egg, so the cap radius is exactly half the short side.
 */
export function speechKnobGeometryFor(
  side: SpeechHudEdgeSide,
  width: number,
  height: number
): SpeechKnobGeometry {
  const radius = Math.min(width, height) / 2;
  const border =
    side === 'right'
      ? `${radius}px 0 0 ${radius}px`
      : side === 'left'
        ? `0 ${radius}px ${radius}px 0`
        : side === 'top'
          ? `0 0 ${radius}px ${radius}px`
          : `${radius}px ${radius}px 0 0`;
  return { width, height, borderRadius: border };
}

export function speechKnobGeometry(side: SpeechHudEdgeSide, dock?: SpeechHudDock): SpeechKnobGeometry {
  const shape = speechEdgeShape(side, dock);
  return speechKnobGeometryFor(side, shape.width, shape.height);
}

/** Corner used by the two rectangular styles; the knob/dot persist their own positions. */
export type SpeechHudVisual = 'speaking' | 'listening' | 'paused' | 'idle' | 'error';

/**
 * Live phase → knob visual (plan 58 addendum). The mic-open phases are the
 * distinct "listening" colour; a reply that is speaking owns the accent;
 * paused, and the settle phases (arming/transcribing/thinking/preparing)
 * stay static; a session error flashes red.
 */
export function liveHudVisual(state: LiveState): SpeechHudVisual {
  switch (state) {
    case 'speaking':
      return 'speaking';
    case 'listening':
      return 'listening';
    case 'paused':
      return 'paused';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export type HudMode = 'speech' | 'live';

/**
 * One presence surface: live outranks the bus while it owns the speaker
 * (plan 25 precedence, plan 58 D7). Live `error` still renders so the knob
 * can flash the failure; `idle` hands the surface back to speech.
 */
export function resolveHudMode(
  live: LiveSnapshot | null | undefined,
  speech: SpeechSnapshot | null | undefined
): HudMode {
  if (!live) {
    return 'speech';
  }
  if (live.state === 'error') {
    return 'live';
  }
  return isLiveActive(live.state) ? 'live' : 'speech';
}

export type HudClickAction =
  | 'none'
  | 'pause'
  | 'resume'
  | 'stop-speech'
  | 'interrupt-live'
  | 'end-live';

export interface HudPresentation {
  mode: HudMode;
  visual: SpeechHudVisual;
  /** What clicking the presence body does (dot, knob, live mini bar). */
  click: HudClickAction;
  /** The small always-visible stop control, and what it stops. */
  stop: 'none' | 'stop-speech' | 'end-live';
  /** Speech only: mini/card show the pause/resume button. */
  pauseControl: boolean;
  /** Speech chunk progress is meaningless in live. */
  showProgress: boolean;
  labels: { body: string; stop?: string; pause?: string; resume?: string };
}

/**
 * ONE style-parameterized mapping (plan 58 addendum + live extension):
 * style + the authoritative snapshots → visual, click action and labels.
 * Live outranks the bus while it owns the speaker and hands the surface
 * back automatically when the session ends.
 */
export function hudPresentation(input: {
  style: SpeechHudStyle;
  live: LiveSnapshot | null | undefined;
  speech: SpeechSnapshot;
}): HudPresentation {
  const { style, live, speech } = input;
  const mode = resolveHudMode(live, speech);
  if (mode === 'live' && live) {
    const visual = liveHudVisual(live.state);
    const dot = style === 'dot';
    return {
      mode,
      visual,
      click: dot ? 'end-live' : 'interrupt-live',
      stop: dot ? 'none' : 'end-live',
      pauseControl: false,
      showProgress: false,
      labels: {
        body: dot ? TEXT.SPEECH_LIVE_END : TEXT.SPEECH_LIVE_INTERRUPT,
        ...(dot ? {} : { stop: TEXT.SPEECH_LIVE_END }),
      },
    };
  }

  const visual = speechVisual(speech.state);
  const paused = speech.state === 'paused';
  const active = speech.state !== 'idle';
  if (style === 'dot') {
    return {
      mode,
      visual,
      click: 'stop-speech',
      stop: 'none',
      pauseControl: false,
      showProgress: false,
      labels: { body: TEXT.SPEECH_STOP },
    };
  }
  if (style === 'edge') {
    return {
      mode,
      visual,
      click: active ? (paused ? 'resume' : 'pause') : 'none',
      stop: 'stop-speech',
      pauseControl: false,
      showProgress: true,
      labels: {
        body: paused ? TEXT.SPEECH_RESUME : TEXT.SPEECH_PAUSE,
        stop: TEXT.SPEECH_STOP,
      },
    };
  }
  return {
    mode,
    visual,
    click: active ? (paused ? 'resume' : 'pause') : 'none',
    stop: 'stop-speech',
    pauseControl: true,
    showProgress: true,
    labels: {
      body: TEXT.SPEECH_HUD_ARIA,
      pause: TEXT.SPEECH_PAUSE,
      resume: TEXT.SPEECH_RESUME,
      stop: TEXT.SPEECH_STOP,
    },
  };
}

function speechVisual(state: SpeechSnapshot['state']): SpeechHudVisual {
  if (state === 'speaking') {
    return 'speaking';
  }
  if (state === 'paused') {
    return 'paused';
  }
  return 'idle';
}

/** The visual the HUD renders for the authoritative mode (shared by every style). */
export function hudVisualFor(mode: HudMode, live: LiveSnapshot | null, speech: SpeechSnapshot): SpeechHudVisual {
  if (mode === 'live' && live) {
    return liveHudVisual(live.state);
  }
  switch (speech.state) {
    case 'speaking':
      return 'speaking';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}
