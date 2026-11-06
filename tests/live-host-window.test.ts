import { describe, it, expect } from 'vitest';
import { buildLiveHostWindowOptions } from '@shared/constants/window';

describe('hidden live host window (plan 61)', () => {
  it('is a never-shown, off-taskbar, unfocusable renderer', () => {
    const options = buildLiveHostWindowOptions({ isDev: true, preloadPath: '/preload.js' });
    expect(options).toMatchObject({
      show: false,
      frame: false,
      transparent: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      alwaysOnTop: false,
    });
    expect(options.webPreferences.preload).toBe('/preload.js');
  });

  it('disables throttling so the mic/VAD keep running while hidden', () => {
    expect(buildLiveHostWindowOptions({ isDev: false }).webPreferences.backgroundThrottling).toBe(false);
  });

  it('keeps the sandbox in production and relaxes it only in dev', () => {
    expect(buildLiveHostWindowOptions({ isDev: false }).webPreferences.sandbox).toBe(true);
    expect(buildLiveHostWindowOptions({ isDev: true }).webPreferences.sandbox).toBe(false);
  });
});
