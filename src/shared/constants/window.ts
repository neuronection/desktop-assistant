// =============================================================================
// WINDOW DIMENSIONS & CONFIGURATIONS
// =============================================================================
import { WindowState, type ResizeCorner } from "@shared/types";
import type { SpeechHudCorner } from "@shared/speech";
import {
  HUD_DOT_SAFE_MARGIN,
  isVerticalEdge,
  speechHudWindowSize,
  type SpeechHudDock,
  type SpeechHudEdgeSide,
  type SpeechHudStyle,
} from "@shared/speechHud";
import type { LiveState } from '@shared/live';
import type { SpeechHudPosture, SpeechState } from '@shared/speech';
const HISTORY_SIDEBAR_WIDTH = 250;

export const WINDOW_SIZE = {
  // Base widths
  COMPACT_WIDTH: 650,
  EXPANDED_WIDTH: 650,

  // Fallback and minimum heights — first-paint estimates only: the chrome
  // is measured by the renderer's ResizeObserver right after mount and
  // the window re-fits. Sized to the two-row composer (permanent toolbar
  // footer) + uniform 12px chrome inset.
  COMPACT_HEIGHT: 98, // Idle launcher bar: composer + chrome only
  MIN_EXPANDED_HEIGHT: 550, // Minimum height when expanded
  CHAT_AREA_BASE_HEIGHT: 320, // Base height for the chat/response area
  SCREEN_SOURCE_PICKER_HEIGHT: 450,

  // Launcher UI-state heights (plan 10 §2–3); responding/done grow with content
  LAUNCHER_THINKING_HEIGHT: 128,
  LAUNCHER_FAILED_HEIGHT: 140,
  LAUNCHER_RESPONSE_BASE_HEIGHT: 150,
  LAUNCHER_RESPONSE_MAX_RATIO: 0.4,

  // Constraints
  MIN_WIDTH: 400,
  MIN_HEIGHT: 72,
  MAX_WIDTH: 1200,
  MAX_HEIGHT: 1000
} as const

export const WINDOW_CONFIG = {
  // Default window options
  DEFAULT: {
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true,
    maximizable: false,
    minimizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  },
  
  // Development-specific options
  DEVELOPMENT: {
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false, // Disabled for dev server
      allowRunningInsecureContent: true,
      experimentalFeatures: true
    }
  },
  
  // Production options
  PRODUCTION: {
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Enable sandbox in production
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  },
  
  // Window behavior
  BEHAVIOR: {
    centerOnCreate: true,
    hideOnBlur: false,
    restorePosition: true,
    rememberSize: true
  }
} as const;

export const WINDOW_STATES = {
  COMPACT: 'compact',
  EXPANDED: 'expanded',
  HIDDEN: 'hidden',
  MINIMIZED: 'minimized'
} as const;

// =============================================================================
// RESPONSIVE BREAKPOINTS
// =============================================================================

export const BREAKPOINTS = {
  SMALL: 480,
  MEDIUM: 768,
  LARGE: 1024,
  XLARGE: 1200
} as const;

// =============================================================================
// WINDOW POSITIONING
// =============================================================================

export const POSITIONING = {
  CENTER: 'center',
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
  REMEMBER_POSITION: 'remember'
} as const;

// =============================================================================
// WINDOW ANIMATIONS
// =============================================================================

export const WINDOW_ANIMATIONS = {
  SHOW_DURATION: 200,
  HIDE_DURATION: 150,
  RESIZE_DURATION: 300,
  FADE_DURATION: 250
} as const;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get appropriate web preferences based on environment
 */
export function getWebPreferences(isDev: boolean, preloadPath?: string) {
  const basePreferences = isDev 
    ? WINDOW_CONFIG.DEVELOPMENT.webPreferences 
    : WINDOW_CONFIG.PRODUCTION.webPreferences;

  return {
    ...basePreferences,
    ...(preloadPath && { preload: preloadPath })
  };
}

/**
 * Get window size for specific state and input mode
 */
// const dimensions = getWindowSize(baseState, this.inputArea.getInputMode(), input_area_heights.input_area, this.isHistoryVisible);

export function getWindowSize(
  state: WindowState.COMPACT | WindowState.EXPANDED,
  inputAreaHeight: number | null,
  isHistoryVisible: boolean | null
): { width: number; height: number } {
  let width: number
  let height: number

  if (state === WindowState.COMPACT) {
    // In compact mode, width is fixed, and height is determined by the input area.
    width = WINDOW_SIZE.COMPACT_WIDTH
    height = inputAreaHeight ?? WINDOW_SIZE.COMPACT_HEIGHT
  } else {
    // In expanded mode, width is fixed, and height is dynamic.
    width = WINDOW_SIZE.EXPANDED_WIDTH

    // The total height is the sum of the chat area and the input area.
    // If inputAreaHeight is not provided, use a small fallback (e.g., 50px).
    const dynamicHeight = WINDOW_SIZE.CHAT_AREA_BASE_HEIGHT + (inputAreaHeight ?? 50)

    // Ensure the height is not less than the minimum defined for expanded mode.
    height = Math.max(WINDOW_SIZE.MIN_EXPANDED_HEIGHT, dynamicHeight)
  }

  // If the history sidebar is visible, add its width to the total width.
  if (isHistoryVisible) {
    width += HISTORY_SIDEBAR_WIDTH
  }

  return { width, height }
}

/**
 * Calculate center position for window
 */
export function getCenterPosition(
  windowWidth: number,
  windowHeight: number,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number } {
  return {
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2)
  };
}

/**
 * Bounds for a manual corner resize: `start` is the snapshot taken at
 * pointer-down, `dx`/`dy` are the pointer deltas since then. Bottom-right
 * grows width/height toward the bottom-right; bottom-left mirrors — width
 * follows the left edge and the origin shifts so the right edge stays
 * anchored. Everything clamps to the min/max constants and the work area.
 */
export function computeCornerResizeBounds(
  start: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
  workArea: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const maxHeight = Math.max(
    WINDOW_SIZE.MIN_HEIGHT,
    Math.min(WINDOW_SIZE.MAX_HEIGHT, workArea.y + workArea.height - start.y)
  );
  const height = Math.min(Math.max(start.height + dy, WINDOW_SIZE.MIN_HEIGHT), maxHeight);

  const maxWidthRight = Math.max(
    WINDOW_SIZE.MIN_WIDTH,
    Math.min(WINDOW_SIZE.MAX_WIDTH, workArea.x + workArea.width - start.x)
  );
  const maxWidthLeft = Math.max(
    WINDOW_SIZE.MIN_WIDTH,
    Math.min(WINDOW_SIZE.MAX_WIDTH, start.x + start.width - workArea.x)
  );

  if (corner === 'bottom-left') {
    const width = Math.min(Math.max(start.width - dx, WINDOW_SIZE.MIN_WIDTH), maxWidthLeft);
    return { x: start.x + start.width - width, y: start.y, width, height };
  }
  const width = Math.min(Math.max(start.width + dx, WINDOW_SIZE.MIN_WIDTH), maxWidthRight);
  return { x: start.x, y: start.y, width, height };
}

/**
 * Moved window position for a manual header drag: `dx`/`dy` are the
 * pointer deltas of this frame. Clamps so at least `minVisible`
 * pixels of the window stay inside the work area — the header can
 * never be dragged out of reach.
 */
export function computeMovedPosition(
  x: number,
  y: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
  workArea: { x: number; y: number; width: number; height: number },
  minVisible = 80
): { x: number; y: number } {
  const minX = workArea.x - width + minVisible;
  const maxX = workArea.x + workArea.width - minVisible;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - minVisible;
  return {
    x: Math.min(maxX, Math.max(minX, x + dx)),
    y: Math.min(maxY, Math.max(minY, y + dy)),
  };
}

/**
 * Validate window dimensions
 */
export function validateDimensions(
  width: number,
  height: number
): { isValid: boolean; adjustedWidth: number; adjustedHeight: number } {
  const adjustedWidth = Math.max(
    WINDOW_SIZE.MIN_WIDTH,
    Math.min(WINDOW_SIZE.MAX_WIDTH, width)
  );
  
  const adjustedHeight = Math.max(
    WINDOW_SIZE.MIN_HEIGHT,
    Math.min(WINDOW_SIZE.MAX_HEIGHT, height)
  );
  
  return {
    isValid: adjustedWidth === width && adjustedHeight === height,
    adjustedWidth,
    adjustedHeight
  };
}

/**
 * Validate window position
 */
export function validatePosition(
  x: number,
  y: number,
  width: number,
  height: number,
  screenWidth: number,
  screenHeight: number
): { isValid: boolean; adjustedX: number; adjustedY: number } {
  const maxX = screenWidth - width;
  const maxY = screenHeight - height;
  
  const adjustedX = Math.max(0, Math.min(maxX, x));
  const adjustedY = Math.max(0, Math.min(maxY, y));
  
  return {
    isValid: adjustedX === x && adjustedY === y,
    adjustedX,
    adjustedY
  };
}


// =============================================================================
// SPEECH HUD OVERLAY (plan 58 §4.2 + addendum)
// =============================================================================

export const SPEECH_HUD_SIZE = { ...speechHudWindowSize('card'), margin: 18 } as const;

/**
 * The textless styles are presence-only surfaces: a solid background reads
 * as a stray rectangle on the desktop, so edge/dot default to glass. An
 * explicit choice always wins — the Transparent-window setting or
 * `DESKTOP_ASSISTANT_OPAQUE` may force the solid fallback (settings) or
 * glass (env) even where the platform default would differ. Card/mini
 * simply follow the window-transparency preference.
 */
export function speechHudTransparentFor(input: {
  style: SpeechHudStyle;
  look: { transparent: boolean; source: string };
  /** The user explicitly chose a transparency value in Settings. */
  explicitlySet: boolean;
}): boolean {
  if (input.style === 'edge' || input.style === 'dot') {
    if (input.look.source === 'env' || input.explicitlySet) {
      return input.look.transparent;
    }
    return true;
  }
  return input.look.transparent;
}

export interface SpeechHudVisibilityInput {
  posture: SpeechHudPosture;
  /** The HUD presentation; the card is a session-only surface regardless of posture. */
  style?: SpeechHudStyle;
  /** A chat surface is visible and not minimized (launcher / desktop mode). */
  chatSurfaceVisible: boolean;
  speechState: SpeechState;
  speechDismissed: boolean;
  liveState: LiveState;
  /** The HUD owns an active dictation or a HUD-initiated turn. */
  hudBusy?: boolean;
}

export type SpeechHudVisibility = 'show' | 'hide' | 'fade';

/**
 * One decision for the HUD's visibility (plan 62). The launcher/desktop and
 * the HUD never share the screen: a visible chat surface always wins, even
 * over a pinned HUD. Dismissal hides the HUD for the current utterance while
 * audio keeps playing in the hidden overlay; live is never dismissed by a
 * speech dismissal. Fade is the 1.5 s post-speech auto hide. The card is a
 * now-playing surface: even pinned it only exists while a session is
 * active — idle presence belongs to the edge knob and the dot.
 */
export function decideSpeechHudVisibility(input: SpeechHudVisibilityInput): SpeechHudVisibility {
  if (input.posture === 'never' || input.chatSurfaceVisible) {
    return 'hide';
  }
  if (input.hudBusy === true) {
    return 'show';
  }
  if (input.liveState !== 'idle') {
    return 'show';
  }
  if (input.speechState !== 'idle') {
    return input.speechDismissed ? 'hide' : 'show';
  }
  if (input.posture === 'pinned' && input.style !== 'card' && !input.speechDismissed) {
    return 'show';
  }
  return 'fade';
}

export const SPEECH_HUD_WINDOW_MARGIN = 18;

export const SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL = 'floating';

/**
 * The hidden live host (plan 61): a never-shown renderer that owns the live
 * mic, VAD and reply playback. Main keeps the state machine; this window is
 * only an audio adapter, so it is off-taskbar, unfocusable and unthrottled.
 */
export function buildLiveHostWindowOptions(input: { isDev: boolean; preloadPath?: string }) {
  return {
    width: 320,
    height: 240,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,
    webPreferences: {
      ...getWebPreferences(input.isDev, input.preloadPath),
      backgroundThrottling: false,
    },
  };
}

/**
 * The hub popover (plan 65): a separate, never-focusable window anchored to
 * the dock. It is not the HUD and is recreated/positioned per open.
 */
export function buildHubPopoverWindowOptions(input: { isDev: boolean; preloadPath?: string }) {
  return {
    width: 340,
    height: 400,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,
    webPreferences: {
      ...getWebPreferences(input.isDev, input.preloadPath),
      backgroundThrottling: false,
    },
  };
}

export const HUB_POPOVER_SIZE = { width: 340, height: 400 } as const;

/** The small transport wing: play/pause + stop, auto-shown while audio plays. */
export const TRANSPORT_POPOVER_SIZE = { width: 86, height: 44 } as const;

export function buildTransportPopoverWindowOptions(input: {
  isDev: boolean;
  preloadPath?: string;
}) {
  return {
    width: TRANSPORT_POPOVER_SIZE.width,
    height: TRANSPORT_POPOVER_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,
    webPreferences: {
      ...getWebPreferences(input.isDev, input.preloadPath),
      backgroundThrottling: false,
    },
  };
}

export function computeTransportPopoverBounds(input: {
  dock: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  side: SpeechHudEdgeSide;
  size?: { width: number; height: number };
  gap?: number;
}): { x: number; y: number; width: number; height: number } {
  const size = input.size ?? TRANSPORT_POPOVER_SIZE;
  const gap = input.gap ?? 6;
  const right = input.workArea.x + input.workArea.width;
  const bottom = input.workArea.y + input.workArea.height;
  let x: number;
  if (input.side === 'right') {
    x = input.dock.x - size.width - gap;
  } else if (input.side === 'left') {
    x = input.dock.x + input.dock.width + gap;
  } else {
    x = input.dock.x + input.dock.width + gap;
    if (x + size.width > right) {
      x = input.dock.x - size.width - gap;
    }
  }
  const y = input.dock.y + (input.dock.height - size.height) / 2;
  return {
    x: Math.round(Math.max(input.workArea.x, Math.min(x, right - size.width))),
    y: Math.round(Math.max(input.workArea.y, Math.min(y, bottom - size.height))),
    width: size.width,
    height: size.height,
  };
}

export interface SpeechOverlayOptionsInput {
  isDev: boolean;
  preloadPath?: string;
  /** `resolveTransparent` result — Cinnamon renders transparent + on-top as nothing. */
  transparent: boolean;
  /** Window shape for the chosen HUD style (defaults to the card). */
  style?: SpeechHudStyle;
  /** Dock side for the edge knob; horizontal docks swap the knob's axes. */
  edgeSide?: SpeechHudEdgeSide;
  /** Wide dock (plan 65): text mode widens the edge tab. */
  dock?: SpeechHudDock;
}

export function buildSpeechOverlayWindowOptions(input: SpeechOverlayOptionsInput) {
  const size = speechHudWindowSize(input.style ?? 'card', input.edgeSide, input.dock);
  return {
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    transparent: input.transparent,
    backgroundColor: input.transparent ? '#00000000' : '#1a1d29',
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,
    webPreferences: {
      ...getWebPreferences(input.isDev, input.preloadPath),
      backgroundThrottling: false,
    },
  };
}

/**
 * A saved corner is a corner, not a coordinate (plan 58 §4.2): bounds are
 * computed at show time against the work area of the display nearest the
 * cursor and clamped so the card never leaves the screen.
 */
export function computeSpeechHudBounds(
  corner: SpeechHudCorner,
  workArea: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number; margin: number } = SPEECH_HUD_SIZE
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const left = workArea.x + size.margin;
  const right = workArea.x + workArea.width - width - size.margin;
  const top = workArea.y + size.margin;
  const bottom = workArea.y + workArea.height - height - size.margin;
  const rawX = corner === 'top-left' || corner === 'bottom-left' ? left : right;
  const rawY = corner === 'top-left' || corner === 'top-right' ? top : bottom;
  return {
    x: Math.round(Math.max(workArea.x, Math.min(rawX, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(rawY, workArea.y + workArea.height - height))),
    width,
    height,
  };
}

export interface HudWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpeechHudPlacement {
  style?: SpeechHudStyle;
  corner?: SpeechHudCorner;
  edge?: { side: SpeechHudEdgeSide; ratio: number };
  dot?: { xRatio: number; yRatio: number };
}

export function clampHudRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * The knob hugs one screen edge; `ratio` walks it along that edge — top (0)
 * to bottom (1) on the left/right docks, left (0) to right (1) on the
 * top/bottom docks. The window box carries the glow padding, so a vertical
 * dock is flush on its docked side while a horizontal dock keeps the 2 px
 * reveal from `speechHudBox`.
 */
export function computeEdgeHudBounds(input: {
  side: SpeechHudEdgeSide;
  ratio: number;
  workArea: HudWorkArea;
  size?: { width: number; height: number };
  dock?: SpeechHudDock;
}): HudBounds {
  const size = input.size ?? speechHudWindowSize('edge', input.side, input.dock);
  const width = Math.min(size.width, input.workArea.width);
  const height = Math.min(size.height, input.workArea.height);
  const ratio = clampHudRatio(input.ratio);
  if (isVerticalEdge(input.side)) {
    const travel = Math.max(0, input.workArea.height - height);
    const x =
      input.side === 'left' ? input.workArea.x : input.workArea.x + input.workArea.width - width;
    return {
      x: Math.round(x),
      y: input.workArea.y + Math.round(ratio * travel),
      width,
      height,
    };
  }
  const travel = Math.max(0, input.workArea.width - width);
  const y =
    input.side === 'top' ? input.workArea.y : input.workArea.y + input.workArea.height - height;
  return {
    x: input.workArea.x + Math.round(ratio * travel),
    y: Math.round(y),
    width,
    height,
  };
}

/**
 * The orb is free-positioned inside a SAFE box: the window is inset by the
 * dot margin on all sides, so ratio 0/1 never touches the screen edge or the
 * taskbar (plan 58 addendum, Part A).
 */
export function computeDotHudBounds(input: {
  xRatio: number;
  yRatio: number;
  workArea: HudWorkArea;
  size?: { width: number; height: number };
  margin?: number;
}): HudBounds {
  const size = input.size ?? speechHudWindowSize('dot');
  const margin = input.margin ?? HUD_DOT_SAFE_MARGIN;
  const width = Math.min(size.width, Math.max(0, input.workArea.width - 2 * margin));
  const height = Math.min(size.height, Math.max(0, input.workArea.height - 2 * margin));
  const travelX = Math.max(0, input.workArea.width - width - 2 * margin);
  const travelY = Math.max(0, input.workArea.height - height - 2 * margin);
  return {
    x: Math.round(input.workArea.x + margin + clampHudRatio(input.xRatio) * travelX),
    y: Math.round(input.workArea.y + margin + clampHudRatio(input.yRatio) * travelY),
    width,
    height,
  };
}

/** Window bounds for any style: corners for the card, the dock for the knob, a safe box for the orb. */
export function computeSpeechHudBoundsForStyle(input: {
  placement: SpeechHudPlacement;
  workArea: HudWorkArea;
  dock?: SpeechHudDock;
}): HudBounds {
  const style = input.placement.style ?? 'card';
  if (style === 'edge') {
    return computeEdgeHudBounds({
      side: input.placement.edge?.side ?? 'right',
      ratio: input.placement.edge?.ratio ?? 0.5,
      workArea: input.workArea,
      dock: input.dock,
    });
  }
  if (style === 'dot') {
    return computeDotHudBounds({
      xRatio: input.placement.dot?.xRatio ?? 1,
      yRatio: input.placement.dot?.yRatio ?? 1,
      workArea: input.workArea,
    });
  }
  return computeSpeechHudBounds(
    input.placement.corner ?? 'bottom-right',
    input.workArea,
    { ...speechHudWindowSize(style), margin: SPEECH_HUD_WINDOW_MARGIN }
  );
}

/** The window's edge-travel ratio for a bounds snapshot (drag persistence). */
export function ratioForEdgeBounds(
  bounds: HudBounds,
  workArea: HudWorkArea,
  side: SpeechHudEdgeSide = 'right'
): number {
  if (isVerticalEdge(side)) {
    const travel = Math.max(0, workArea.height - bounds.height);
    return travel === 0 ? 0.5 : clampHudRatio((bounds.y - workArea.y) / travel);
  }
  const travel = Math.max(0, workArea.width - bounds.width);
  return travel === 0 ? 0.5 : clampHudRatio((bounds.x - workArea.x) / travel);
}

export function ratioForDotBounds(
  bounds: HudBounds,
  workArea: HudWorkArea,
  margin: number = HUD_DOT_SAFE_MARGIN
): { xRatio: number; yRatio: number } {
  const travelX = Math.max(0, workArea.width - bounds.width - 2 * margin);
  const travelY = Math.max(0, workArea.height - bounds.height - 2 * margin);
  return {
    xRatio: travelX === 0 ? 0.5 : clampHudRatio((bounds.x - workArea.x - margin) / travelX),
    yRatio: travelY === 0 ? 0.5 : clampHudRatio((bounds.y - workArea.y - margin) / travelY),
  };
}

/** Snap stops for the knob (one-third landmarks) — a drop near one lands on it. */
export const EDGE_SNAP_STOPS: readonly number[] = [0.08, 0.5, 0.92];

export function snapHudRatio(ratio: number, stops: readonly number[] = EDGE_SNAP_STOPS, threshold = 0.06): number {
  const value = clampHudRatio(ratio);
  for (const stop of stops) {
    if (Math.abs(value - stop) <= threshold) {
      return clampHudRatio(stop);
    }
  }
  return Math.round(value * 100) / 100;
}

/** Nearest corner for a dropped card. */
export function nearestHudCorner(bounds: HudBounds, workArea: HudWorkArea): SpeechHudCorner {
  const centerX = bounds.x + bounds.width / 2 - workArea.x;
  const centerY = bounds.y + bounds.height / 2 - workArea.y;
  const vertical = centerY < workArea.height / 2 ? 'top' : 'bottom';
  const horizontal = centerX < workArea.width / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as SpeechHudCorner;
}

export interface HudDragInput {
  style: SpeechHudStyle;
  origin: HudBounds;
  dx: number;
  dy: number;
  workArea: HudWorkArea;
  edgeSide?: SpeechHudEdgeSide;
}

/**
 * A live drag in progress. Card/mini and the orb move freely inside the work
 * area; the knob only slides along its docked edge (the flat side keeps
 * hugging the screen border).
 */
export function dragHudBounds(input: HudDragInput): HudBounds {
  const { origin, dx, dy, workArea } = input;
  if (input.style === 'edge') {
    const side = input.edgeSide ?? 'right';
    if (isVerticalEdge(side)) {
      const y = Math.round(
        Math.min(Math.max(origin.y + dy, workArea.y), workArea.y + workArea.height - origin.height)
      );
      const x = side === 'left' ? workArea.x : workArea.x + workArea.width - origin.width;
      return { x, y, width: origin.width, height: origin.height };
    }
    const x = Math.round(
      Math.min(Math.max(origin.x + dx, workArea.x), workArea.x + workArea.width - origin.width)
    );
    const y = side === 'top' ? workArea.y : workArea.y + workArea.height - origin.height;
    return { x, y, width: origin.width, height: origin.height };
  }
  const x = Math.round(
    Math.min(Math.max(origin.x + dx, workArea.x), workArea.x + workArea.width - origin.width)
  );
  const y = Math.round(
    Math.min(Math.max(origin.y + dy, workArea.y), workArea.y + workArea.height - origin.height)
  );
  return { x, y, width: origin.width, height: origin.height };
}

export interface HudDropPlacement {
  corner?: SpeechHudCorner;
  edge?: { side: SpeechHudEdgeSide; ratio: number };
  dot?: { xRatio: number; yRatio: number };
}

/**
 * Turns a dropped position into the persisted placement: the card snaps to
 * the nearest corner, the knob snaps to a landmark ratio, the orb keeps its
 * free fraction (already inside the safe box).
 */
export function dropHudPlacement(input: {
  style: SpeechHudStyle;
  bounds: HudBounds;
  workArea: HudWorkArea;
  edgeSide?: SpeechHudEdgeSide;
}): HudDropPlacement {
  if (input.style === 'edge') {
    return {
      edge: {
        side: input.edgeSide ?? 'right',
        ratio: snapHudRatio(ratioForEdgeBounds(input.bounds, input.workArea, input.edgeSide ?? 'right')),
      },
    };
  }
  if (input.style === 'dot') {
    return { dot: ratioForDotBounds(input.bounds, input.workArea) };
  }
  return { corner: nearestHudCorner(input.bounds, input.workArea) };
}

/** Cross-edge drag policy (plan 65 follow-up). */
export const EDGE_SWITCH_TRIGGER_PX = 32;
export const EDGE_SWITCH_INNER_RATIO = 0.8;
export const EDGE_SWITCH_DWELL_MS = 150;
export const EDGE_SWITCH_COOLDOWN_MS = 300;
export const EDGE_SWITCH_EXIT_PX = 48;
export const EDGE_SWITCH_MIN_DRAG_PX = 24;

export interface EdgeSwitchInput {
  cursor: { x: number; y: number };
  workArea: HudWorkArea;
  currentSide: SpeechHudEdgeSide;
  blockedSide?: SpeechHudEdgeSide | null;
  triggerPx?: number;
  innerRatio?: number;
  exitPx?: number;
}

export interface EdgeSwitchTarget {
  side: SpeechHudEdgeSide;
  distance: number;
}

export function edgeSwitchTarget(input: EdgeSwitchInput): EdgeSwitchTarget | null {
  const trigger = input.triggerPx ?? EDGE_SWITCH_TRIGGER_PX;
  const exit = input.exitPx ?? EDGE_SWITCH_EXIT_PX;
  const inner = Math.min(1, Math.max(0.5, input.innerRatio ?? EDGE_SWITCH_INNER_RATIO));
  const insetX = ((1 - inner) / 2) * input.workArea.width;
  const insetY = ((1 - inner) / 2) * input.workArea.height;
  const right = input.workArea.x + input.workArea.width;
  const bottom = input.workArea.y + input.workArea.height;
  const candidates: EdgeSwitchTarget[] = [];
  const consider = (
    side: SpeechHudEdgeSide,
    distance: number,
    along: number,
    from: number,
    to: number
  ): void => {
    if (side === input.currentSide || distance < 0 || distance > trigger) {
      return;
    }
    if (input.blockedSide === side && distance < exit) {
      return;
    }
    if (along < from || along > to) {
      return;
    }
    candidates.push({ side, distance });
  };
  consider('top', input.cursor.y - input.workArea.y, input.cursor.x, input.workArea.x + insetX, right - insetX);
  consider('bottom', bottom - input.cursor.y, input.cursor.x, input.workArea.x + insetX, right - insetX);
  consider('left', input.cursor.x - input.workArea.x, input.cursor.y, input.workArea.y + insetY, bottom - insetY);
  consider('right', right - input.cursor.x, input.cursor.y, input.workArea.y + insetY, bottom - insetY);
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0] ?? null;
}
