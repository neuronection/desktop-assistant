import { describe, it, expect } from 'vitest';
import {
  RESPONSE_PANEL_CHROME_PX,
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

  it('window height covers content, panel chrome and both margins with no shortfall', () => {
    const chrome = 96;
    const content = 200;
    const panel = desiredResponsePanelHeight(content, 1000);
    const total = compactWindowHeight('done', chrome, panel);

    expect(total).toBe(chrome + panel + 18);
    expect(total - chrome - 18).toBeGreaterThanOrEqual(content + RESPONSE_PANEL_CHROME_PX);
  });

  it('responding and done share the same budget', () => {
    expect(compactWindowHeight('responding', 96, 218)).toBe(compactWindowHeight('done', 96, 218));
  });

  it('falls back to fixed heights when chrome is not measured yet', () => {
    expect(compactWindowHeight('idle', 0, 0)).toBe(WINDOW_SIZE.COMPACT_HEIGHT + 4);
    expect(compactWindowHeight('thinking', 0, 0)).toBe(WINDOW_SIZE.LAUNCHER_THINKING_HEIGHT + 4);
    expect(compactWindowHeight('failed', 0, 0)).toBe(WINDOW_SIZE.LAUNCHER_FAILED_HEIGHT + 4);
  });
});
