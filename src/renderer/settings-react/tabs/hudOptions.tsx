import type { JSX } from 'react';
import { AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

export const HUD_STYLE_OPTIONS: { value: AppConfig['voice']['speechHudStyle']; label: string; preview: string }[] = [
  { value: 'card', label: TEXT.VOICE_SPEECH_HUD_STYLE_CARD, preview: 'h-4 w-9 rounded-[4px]' },
  { value: 'edge', label: TEXT.VOICE_SPEECH_HUD_STYLE_EDGE, preview: 'h-6 w-1.5 rounded-full' },
  { value: 'dot', label: TEXT.VOICE_SPEECH_HUD_STYLE_DOT, preview: 'h-2.5 w-2.5 rounded-full' },
];

export const HUD_DOCKS: { value: AppConfig['voice']['speechHudEdgeSide']; label: string }[] = [
  { value: 'left', label: TEXT.VOICE_SPEECH_HUD_DOCK_LEFT },
  { value: 'right', label: TEXT.VOICE_SPEECH_HUD_DOCK_RIGHT },
  { value: 'top', label: TEXT.VOICE_SPEECH_HUD_DOCK_TOP },
  { value: 'bottom', label: TEXT.VOICE_SPEECH_HUD_DOCK_BOTTOM },
];

export const HUD_CORNERS: { value: AppConfig['voice']['speechHudCorner']; label: string }[] = [
  { value: 'top-left', label: TEXT.VOICE_SPEECH_HUD_TOP_LEFT },
  { value: 'top-right', label: TEXT.VOICE_SPEECH_HUD_TOP_RIGHT },
  { value: 'bottom-left', label: TEXT.VOICE_SPEECH_HUD_BOTTOM_LEFT },
  { value: 'bottom-right', label: TEXT.VOICE_SPEECH_HUD_BOTTOM_RIGHT },
];

export const HUD_CORNER_MARKERS: Record<AppConfig['voice']['speechHudCorner'], string> = {
  'top-left': 'left-1 top-1 h-1.5 w-1.5',
  'top-right': 'right-1 top-1 h-1.5 w-1.5',
  'bottom-left': 'left-1 bottom-1 h-1.5 w-1.5',
  'bottom-right': 'right-1 bottom-1 h-1.5 w-1.5',
};

export const HUD_DOCK_MARKERS: Record<AppConfig['voice']['speechHudEdgeSide'], string> = {
  right: 'right-0 top-1/2 h-3 w-0.5 -translate-y-1/2',
  left: 'left-0 top-1/2 h-3 w-0.5 -translate-y-1/2',
  top: 'top-0 left-1/2 h-0.5 w-3 -translate-x-1/2',
  bottom: 'bottom-0 left-1/2 h-0.5 w-3 -translate-x-1/2',
};

export function HudPositionGlyph({ marker }: { marker: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="relative h-7 w-10 shrink-0 rounded-[4px] border border-[var(--as-border)] bg-[var(--as-secondary)]"
    >
      <span className={`absolute rounded-[1px] bg-[var(--as-primary)] ${marker}`} />
    </span>
  );
}

export const positionButtonClass = (selected: boolean): string =>
  `flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
    selected
      ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10'
      : 'border-[var(--as-border)] hover:bg-[var(--as-secondary)]'
  }`;

export const HUD_POSTURES: { value: AppConfig['voice']['speechHudPosture']; label: string }[] = [
  { value: 'auto', label: TEXT.VOICE_SPEECH_HUD_POSTURE_AUTO },
  { value: 'pinned', label: TEXT.VOICE_SPEECH_HUD_POSTURE_PINNED },
  { value: 'never', label: TEXT.VOICE_SPEECH_HUD_POSTURE_NEVER },
];
