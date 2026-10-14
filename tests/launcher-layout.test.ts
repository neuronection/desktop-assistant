import { describe, it, expect } from 'vitest';
import {
  RESPONSE_PANEL_CHROME_PX,
  RESPONSE_PANEL_INSET_PX,
  RESPONSE_WINDOW_SLACK_PX,
  desiredResponsePanelHeight,
  compactWindowHeight,
} from '@renderer/chat-react/launcherLayout';
import { WINDOW_SIZE } from '@shared/constants/window';

describe('launcher response layout', () => {
  it('budgets the panel chrome (padding + border) on top of the content', () => {
    expect(desiredResponsePanelHeight(200, 1000)).toBe(200 + RESPONSE_PANEL_CHROME_PX);
  });

  it('caps the panel at the screen ratio budget', () => {
    expect(desiredResponsePanelHeight(100_000, 400)).toBe(400);
  });

  it('window height covers content, panel chrome and the top inset with no shortfall', () => {
    const chrome = 96;
    const content = 200;
    const panel = desiredResponsePanelHeight(content, 1000);
    const total = compactWindowHeight('done', chrome, panel);

    expect(total).toBe(chrome + panel + RESPONSE_PANEL_INSET_PX + RESPONSE_WINDOW_SLACK_PX);
    expect(total - chrome - RESPONSE_PANEL_INSET_PX - RESPONSE_WINDOW_SLACK_PX).toBeGreaterThanOrEqual(content + RESPONSE_PANEL_CHROME_PX);
  });

  it('responding and done share the same budget', () => {
    expect(compactWindowHeight('responding', 96, 218)).toBe(compactWindowHeight('done', 96, 218));
  });

  it('uses the measured chrome as-is outside response states (uniform inset, no additive slack)', () => {
    expect(compactWindowHeight('idle', 98, 0)).toBe(98);
    expect(compactWindowHeight('thinking', 130, 0)).toBe(130);
    expect(compactWindowHeight('queued', 120, 0)).toBe(120);
  });

  it('falls back to fixed heights when chrome is not measured yet', () => {
    expect(compactWindowHeight('idle', 0, 0)).toBe(WINDOW_SIZE.COMPACT_HEIGHT);
    expect(compactWindowHeight('thinking', 0, 0)).toBe(WINDOW_SIZE.LAUNCHER_THINKING_HEIGHT);
    expect(compactWindowHeight('failed', 0, 0)).toBe(WINDOW_SIZE.LAUNCHER_FAILED_HEIGHT);
  });
});
