import React from 'react';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL, type LiveSnapshot } from '@shared/live';
import {
  SPEECH_HUD_EDGE_SIDES,
  SPEECH_HUD_STYLES,
  type SpeechHudEdgeSide,
  type SpeechHudStyle,
  type SpeechHudVisual,
} from '@shared/speechHud';
import { SpeechHud } from './SpeechHud';

/**
 * Dev-only capture harness (plan 58 addendum): the real overlay renderer is
 * opened in a plain browser with `?capStyle=…&capVisual=…` and synthetic
 * snapshots, so the redesign can be screenshotted at 2× without driving a
 * real speech queue or microphone. It is inert inside Electron (the preload
 * bridge always exists there) and in production builds (nothing asks for it).
 */
export interface HudCapture {
  style: SpeechHudStyle;
  visual: SpeechHudVisual;
  side: SpeechHudEdgeSide;
  opaque: boolean;
  text: boolean;
  dockText: string;
  dictating: boolean;
  selection: boolean;
}

const VISUALS: readonly SpeechHudVisual[] = ['idle', 'speaking', 'listening', 'paused', 'error'];

function isStyle(value: string | null): value is SpeechHudStyle {
  return value !== null && (SPEECH_HUD_STYLES as readonly string[]).includes(value);
}

function isVisual(value: string | null): value is SpeechHudVisual {
  return value !== null && (VISUALS as readonly string[]).includes(value);
}

function isSide(value: string | null): value is SpeechHudEdgeSide {
  return value !== null && (SPEECH_HUD_EDGE_SIDES as readonly string[]).includes(value);
}

export function parseHudCapture(search: string): HudCapture | null {
  const params = new URLSearchParams(search);
  if (!isStyle(params.get('capStyle'))) {
    return null;
  }
  return {
    style: params.get('capStyle') as SpeechHudStyle,
    visual: isVisual(params.get('capVisual')) ? (params.get('capVisual') as SpeechHudVisual) : 'idle',
    side: isSide(params.get('capSide')) ? (params.get('capSide') as SpeechHudEdgeSide) : 'right',
    opaque: params.get('capOpaque') === '1',
    text: params.get('capText') === '1',
    dockText: params.get('capDockText') ?? '',
    dictating: params.get('capDictating') === '1',
    selection: params.get('capSelection') === '1',
  };
}

function captureSpeech(visual: SpeechHudVisual): SpeechSnapshot {
  if (visual === 'speaking') {
    return {
      ...SPEECH_INITIAL,
      state: 'speaking',
      source: 'reply',
      utteranceId: 7,
      chunkIndex: 2,
      chunkCount: 7,
      chunkText: 'Here is the summary you asked for, with the two open questions.',
      resumeTo: 'speaking',
    };
  }
  if (visual === 'paused') {
    return {
      ...SPEECH_INITIAL,
      state: 'paused',
      source: 'reply',
      utteranceId: 7,
      chunkIndex: 2,
      chunkCount: 7,
      chunkText: 'Paused mid-sentence, waiting for you.',
      resumeTo: 'speaking',
    };
  }
  return SPEECH_INITIAL;
}

function captureLive(visual: SpeechHudVisual): LiveSnapshot | null {
  if (visual === 'listening') {
    return { ...LIVE_INITIAL, state: 'listening', capture: 'open', session: 3 };
  }
  if (visual === 'error') {
    return { ...LIVE_INITIAL, state: 'error', session: 3 };
  }
  return null;
}

export function SpeechHudCapture({ capture }: { capture: HudCapture }): React.ReactElement {
  return (
    <SpeechHud
      snapshot={captureSpeech(capture.visual)}
      live={captureLive(capture.visual)}
      style={capture.style}
      edgeSide={capture.side}
      opaque={capture.opaque}
      dock={capture.text ? { text: true, width: 160 } : undefined}
      dockText={capture.dockText}
      dictating={capture.dictating}
      selection={capture.selection}
      dotActions={
        capture.style === 'dot'
          ? ['speak-selection', 'dictate', 'live-toggle']
          : []
      }
      dotDirection="end"
      onDictate={() => undefined}
      onSendDictation={() => undefined}
      onCancelDictation={() => undefined}
      onTogglePause={() => undefined}
      onStop={() => undefined}
      onInterruptLive={() => undefined}
      onEndLive={() => undefined}
    />
  );
}
