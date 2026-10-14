import { WINDOW_SIZE } from '@shared/constants/window';
import type { LauncherUiState } from './launcherState';

export const RESPONSE_PANEL_CHROME_PX = 18;
export const RESPONSE_PANEL_INSET_PX = 12;
export const RESPONSE_WINDOW_SLACK_PX = 2;
export const SCROLL_STICK_THRESHOLD_PX = 8;

const COMPACT_FIXED_HEIGHTS: Record<string, number> = {
  idle: WINDOW_SIZE.COMPACT_HEIGHT,
  thinking: WINDOW_SIZE.LAUNCHER_THINKING_HEIGHT,
  failed: WINDOW_SIZE.LAUNCHER_FAILED_HEIGHT,
};

export function desiredResponsePanelHeight(contentScrollHeight: number, maxPanelHeight: number): number {
  return Math.min(contentScrollHeight + RESPONSE_PANEL_CHROME_PX, maxPanelHeight);
}

export function isScrolledToBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, thresholdPx = SCROLL_STICK_THRESHOLD_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

// The chrome wrapper carries the launcher's uniform 12px inset (p-3 in
// ChatApp) — offsetHeight already includes it, so the measured height is
// used as-is; the response panel adds its own top inset plus a rounding
// slack (its flex-1 body absorbs it, keeping every edge at 12px).
export function compactWindowHeight(ui: LauncherUiState, chromeHeight: number, panelHeight: number): number {
  const chrome = chromeHeight > 0 ? chromeHeight : COMPACT_FIXED_HEIGHTS[ui] ?? WINDOW_SIZE.COMPACT_HEIGHT;
  if (ui === 'responding' || ui === 'done') {
    return chrome + panelHeight + RESPONSE_PANEL_INSET_PX + RESPONSE_WINDOW_SLACK_PX;
  }
  return chrome;
}
