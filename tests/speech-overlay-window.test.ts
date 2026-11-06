import { describe, it, expect } from 'vitest';
import {
  SPEECH_HUD_SIZE,
  SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL,
  buildSpeechOverlayWindowOptions,
  computeDotHudBounds,
  computeEdgeHudBounds,
  computeSpeechHudBounds,
  computeSpeechHudBoundsForStyle,
  edgeSwitchTarget,
  buildHubPopoverWindowOptions,
  buildTransportPopoverWindowOptions,
  computeTransportPopoverBounds,
  HUB_POPOVER_SIZE,
  TRANSPORT_POPOVER_SIZE,
  dragHudBounds,
  dropHudPlacement,
  nearestHudCorner,
  ratioForDotBounds,
  ratioForEdgeBounds,
  snapHudRatio,
  speechHudTransparentFor,
} from '@shared/constants/window';
import {
  dotStripWidth,
  HUD_DOT_SAFE_MARGIN,
  HUD_DOT_STRIP,
  HUD_EDGE_REVEAL,
  HUD_GLOW_PAD,
  SPEECH_HUD_MIN_CLICKABLE,
  SPEECH_HUD_SHAPES,
  speechHudBox,
  speechHudWindowSize,
} from '@shared/speechHud';

describe('edge switch policy (plan 65 follow-up)', () => {
  const workArea = { x: 0, y: 0, width: 1000, height: 800 };

  it('only accepts the central 80% of another edge within 32 px', () => {
    expect(
      edgeSwitchTarget({ cursor: { x: 500, y: 20 }, workArea, currentSide: 'right' })
    ).toEqual({ side: 'top', distance: 20 });
    expect(
      edgeSwitchTarget({ cursor: { x: 980, y: 400 }, workArea, currentSide: 'top' })
    ).toEqual({ side: 'right', distance: 20 });
    expect(edgeSwitchTarget({ cursor: { x: 40, y: 20 }, workArea, currentSide: 'right' })).toBeNull();
    expect(edgeSwitchTarget({ cursor: { x: 500, y: 40 }, workArea, currentSide: 'right' })).toBeNull();
    expect(edgeSwitchTarget({ cursor: { x: 500, y: 20 }, workArea, currentSide: 'top' })).toBeNull();
  });

  it('uses the exit hysteresis before allowing the side just left again', () => {
    expect(
      edgeSwitchTarget({
        cursor: { x: 980, y: 400 },
        workArea,
        currentSide: 'left',
        blockedSide: 'right',
      })
    ).toBeNull();
    expect(
      edgeSwitchTarget({
        cursor: { x: 900, y: 400 },
        workArea,
        currentSide: 'left',
        blockedSide: 'right',
      })
    ).toBeNull();
  });
});

describe('speech overlay window options (plan 58 §4.2)', () => {
  it('is a non-focusable, non-taskbar, unthrottled HUD that never steals the keyboard', () => {
    const options = buildSpeechOverlayWindowOptions({ isDev: false, preloadPath: '/preload.js', transparent: true });
    expect(options).toMatchObject({
      width: SPEECH_HUD_SIZE.width,
      height: SPEECH_HUD_SIZE.height,
      show: false,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: false,
      webPreferences: { backgroundThrottling: false, preload: '/preload.js' },
    });
    expect(options.webPreferences.sandbox).toBe(true);
  });

  it('sizes the wide dock from the text config', () => {
    const options = buildSpeechOverlayWindowOptions({
      isDev: false,
      transparent: true,
      style: 'edge',
      edgeSide: 'right',
      dock: { text: true, width: 160 },
    });
    expect(options).toMatchObject({ width: 240, height: 97 });
    const horizontal = buildSpeechOverlayWindowOptions({
      isDev: false,
      transparent: true,
      style: 'edge',
      edgeSide: 'bottom',
      dock: { text: true, width: 160 },
    });
    expect(horizontal).toMatchObject({ width: 240, height: 97 });
  });

  it('keeps the wide dock on its screen edge when positioning', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const bounds = computeEdgeHudBounds({
      side: 'right',
      ratio: 0.5,
      workArea,
      dock: { text: true, width: 160 },
    });
    expect(bounds.width).toBe(240);
    expect(bounds.x).toBe(1920 - 240);
    expect(bounds.y).toBe(Math.round((1080 - bounds.height) / 2));

    const top = computeEdgeHudBounds({
      side: 'top',
      ratio: 0.5,
      workArea,
      dock: { text: true, width: 160 },
    });
    expect(top.y).toBe(0);
    expect(top.x).toBe(Math.round((1920 - top.width) / 2));
  });

  it('builds a small non-focusable transport wing', () => {
    const options = buildTransportPopoverWindowOptions({ isDev: false, preloadPath: '/preload.js' });
    expect(options).toMatchObject({
      width: TRANSPORT_POPOVER_SIZE.width,
      height: TRANSPORT_POPOVER_SIZE.height,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: { preload: '/preload.js', backgroundThrottling: false },
    });
  });

  it('anchors the transport wing inward from the dock and clamps it', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    const dock = { x: 1680, y: 500, width: 240, height: 97 };
    expect(
      computeTransportPopoverBounds({ dock, workArea, side: 'right' })
    ).toMatchObject({ x: 1588, y: 527, width: 86, height: 44 });
    expect(
      computeTransportPopoverBounds({ dock: { ...dock, x: 0 }, workArea, side: 'left' })
    ).toMatchObject({ x: 246, y: 527 });
    expect(
      computeTransportPopoverBounds({
        dock: { ...dock, x: 1720, width: 200 },
        workArea,
        side: 'top',
      })
    ).toMatchObject({ x: 1628 });
  });

  it('builds a non-focusable popover window', () => {
    const options = buildHubPopoverWindowOptions({ isDev: false, preloadPath: '/preload.js' });
    expect(options).toMatchObject({
      width: HUB_POPOVER_SIZE.width,
      height: HUB_POPOVER_SIZE.height,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: { preload: '/preload.js', backgroundThrottling: false },
    });
  });

  it('keeps the dev webPreferences relaxed (dev server needs them)', () => {
    const options = buildSpeechOverlayWindowOptions({ isDev: true, transparent: false });
    expect(options.webPreferences.sandbox).toBe(false);
    expect(options.webPreferences.webSecurity).toBe(false);
    expect(options.backgroundColor).toBe('#1a1d29');
  });

  it('emits a non-screen-saver always-on-top level applied after creation', () => {
    expect(SPEECH_OVERLAY_ALWAYS_ON_TOP_LEVEL).toBe('floating');
    const options = buildSpeechOverlayWindowOptions({ isDev: false, transparent: true });
    expect(options).not.toHaveProperty('alwaysOnTopLevel');
  });
});

describe('speech HUD positioning (plan 58 §4.2)', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  it('places the card in the configured corner of the work area', () => {
    const size = { ...SPEECH_HUD_SIZE };
    const expectedX = workArea.width - size.width - size.margin;
    const expectedY = workArea.height - size.height - size.margin;
    expect(computeSpeechHudBounds('bottom-right', workArea)).toMatchObject({ x: expectedX, y: expectedY });
    expect(computeSpeechHudBounds('bottom-left', workArea)).toMatchObject({ x: size.margin, y: expectedY });
    expect(computeSpeechHudBounds('top-right', workArea)).toMatchObject({ x: expectedX, y: size.margin });
    expect(computeSpeechHudBounds('top-left', workArea)).toMatchObject({ x: size.margin, y: size.margin });
  });

  it('follows a secondary display offset', () => {
    const second = { x: 1920, y: 0, width: 1280, height: 720 };
    const bounds = computeSpeechHudBounds('bottom-right', second);
    expect(bounds.x).toBeGreaterThanOrEqual(second.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(second.x + second.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(second.y + second.height);
  });

  it('works in DIPs for a scaled display (no physical-pixel math)', () => {
    const scaled = { x: 0, y: 0, width: 1536, height: 864 };
    const bounds = computeSpeechHudBounds('bottom-right', scaled);
    expect(bounds).toMatchObject({ width: SPEECH_HUD_SIZE.width, height: SPEECH_HUD_SIZE.height });
    expect(bounds.x + bounds.width).toBe(scaled.width - SPEECH_HUD_SIZE.margin);
    expect(bounds.y + bounds.height).toBe(scaled.height - SPEECH_HUD_SIZE.margin);
  });

  it('clamps inside a work area smaller than the card', () => {
    const tiny = { x: 100, y: 50, width: 200, height: 40 };
    const bounds = computeSpeechHudBounds('bottom-right', tiny);
    expect(bounds).toEqual({ x: 100, y: 50, width: 200, height: 40 });
  });
});


describe('HUD style windows (plan 58 addendum)', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  it('sizes each window as its visible shape plus glow padding', () => {
    expect(SPEECH_HUD_SHAPES.card).toEqual({ width: 400, height: 72 });
    expect(SPEECH_HUD_SHAPES.edge).toEqual({ width: 30, height: 68 });
    expect(SPEECH_HUD_SHAPES.dot).toEqual({ width: 28, height: 28 });

    expect(speechHudWindowSize('card')).toEqual({ width: 400 + 2 * HUD_GLOW_PAD, height: 72 + 2 * HUD_GLOW_PAD });
    expect(speechHudWindowSize('dot')).toEqual({
      width: 28 + HUD_DOT_STRIP.gap + dotStripWidth() + 2 * HUD_GLOW_PAD,
      height: 28 + 2 * HUD_GLOW_PAD,
    });

    for (const style of ['card', 'edge', 'dot'] as const) {
      const options = buildSpeechOverlayWindowOptions({ isDev: false, transparent: true, style });
      expect(options, style).toMatchObject(speechHudWindowSize(style));
    }
    expect(speechHudWindowSize('edge', 'right')).toEqual({ width: 30 + HUD_GLOW_PAD, height: 68 + 2 * HUD_GLOW_PAD });
    expect(speechHudWindowSize('edge', 'left')).toEqual({ width: 30 + HUD_GLOW_PAD, height: 68 + 2 * HUD_GLOW_PAD });
    expect(speechHudWindowSize('edge', 'top')).toEqual({
      width: 68 + 2 * HUD_GLOW_PAD,
      height: 30 + HUD_GLOW_PAD + HUD_EDGE_REVEAL,
    });
    expect(speechHudWindowSize('edge', 'bottom')).toEqual({
      width: 68 + 2 * HUD_GLOW_PAD,
      height: 30 + HUD_GLOW_PAD + HUD_EDGE_REVEAL,
    });
    expect(SPEECH_HUD_SHAPES.dot.width).toBeGreaterThanOrEqual(SPEECH_HUD_MIN_CLICKABLE);
  });

  it('keeps the knob flush on its dock and reveals 2px on the top/bottom dock', () => {
    const right = speechHudBox('edge', 'right');
    expect(right.pad).toEqual({ top: HUD_GLOW_PAD, right: 0, bottom: HUD_GLOW_PAD, left: HUD_GLOW_PAD });
    const left = speechHudBox('edge', 'left');
    expect(left.pad).toEqual({ top: HUD_GLOW_PAD, right: HUD_GLOW_PAD, bottom: HUD_GLOW_PAD, left: 0 });
    expect(speechHudBox('edge', 'top').pad.top).toBe(HUD_EDGE_REVEAL);
    expect(speechHudBox('edge', 'bottom').pad.bottom).toBe(HUD_EDGE_REVEAL);
  });

  it('docks the knob to all four edges and walks it along a ratio', () => {
    const size = speechHudWindowSize('edge', 'right');
    expect(computeEdgeHudBounds({ side: 'right', ratio: 0.5, workArea })).toEqual({
      x: workArea.width - size.width,
      y: Math.round((workArea.height - size.height) * 0.5),
      width: size.width,
      height: size.height,
    });
    expect(computeEdgeHudBounds({ side: 'left', ratio: 0.5, workArea }).x).toBe(0);
    expect(computeEdgeHudBounds({ side: 'right', ratio: 0, workArea }).y).toBe(0);
    expect(computeEdgeHudBounds({ side: 'right', ratio: 1, workArea }).y).toBe(workArea.height - size.height);

    const top = speechHudWindowSize('edge', 'top');
    expect(computeEdgeHudBounds({ side: 'top', ratio: 0.25, workArea })).toEqual({
      x: Math.round((workArea.width - top.width) * 0.25),
      y: 0,
      width: top.width,
      height: top.height,
    });
    const bottom = speechHudWindowSize('edge', 'bottom');
    expect(computeEdgeHudBounds({ side: 'bottom', ratio: 0.75, workArea })).toMatchObject({
      x: Math.round((workArea.width - bottom.width) * 0.75),
      y: workArea.height - bottom.height,
    });
  });

  it('clamps an out-of-range or broken knob ratio', () => {
    expect(computeEdgeHudBounds({ side: 'right', ratio: -3, workArea }).y).toBe(0);
    expect(computeEdgeHudBounds({ side: 'right', ratio: 9, workArea }).y).toBe(
      workArea.height - speechHudWindowSize('edge').height
    );
    expect(computeEdgeHudBounds({ side: 'right', ratio: Number.NaN, workArea }).y).toBe(
      Math.round((workArea.height - speechHudWindowSize('edge').height) * 0.5)
    );
  });

  it('clamps the knob inside a work area shorter than the knob', () => {
    const tiny = { x: 10, y: 20, width: 100, height: 40 };
    const bounds = computeEdgeHudBounds({ side: 'right', ratio: 0.9, workArea: tiny });
    expect(bounds).toEqual({ x: 10 + 100 - 40, y: 20, width: 40, height: 40 });
  });

  it('insets the orb travel box so no ratio touches the screen edge (Part A)', () => {
    const size = speechHudWindowSize('dot');
    const travelX = workArea.width - size.width - 2 * HUD_DOT_SAFE_MARGIN;
    const travelY = workArea.height - size.height - 2 * HUD_DOT_SAFE_MARGIN;
    expect(computeDotHudBounds({ xRatio: 0, yRatio: 0, workArea })).toMatchObject({
      x: HUD_DOT_SAFE_MARGIN,
      y: HUD_DOT_SAFE_MARGIN,
    });
    expect(computeDotHudBounds({ xRatio: 0.5, yRatio: 0.5, workArea })).toMatchObject({
      x: Math.round(HUD_DOT_SAFE_MARGIN + travelX * 0.5),
      y: Math.round(HUD_DOT_SAFE_MARGIN + travelY * 0.5),
    });
    expect(computeDotHudBounds({ xRatio: 1, yRatio: 1, workArea })).toMatchObject({
      x: HUD_DOT_SAFE_MARGIN + travelX,
      y: HUD_DOT_SAFE_MARGIN + travelY,
    });
    expect(computeDotHudBounds({ xRatio: 5, yRatio: -2, workArea })).toMatchObject({
      x: HUD_DOT_SAFE_MARGIN + travelX,
      y: HUD_DOT_SAFE_MARGIN,
    });
  });

  it('defaults the orb to a bottom-right safe area at least 12px off both edges', () => {
    const bounds = computeSpeechHudBoundsForStyle({
      placement: { style: 'dot' },
      workArea,
    });
    const visibleRight = bounds.x + bounds.width - HUD_GLOW_PAD;
    const visibleBottom = bounds.y + bounds.height - HUD_GLOW_PAD;
    expect(workArea.width - visibleRight).toBeGreaterThanOrEqual(HUD_DOT_SAFE_MARGIN);
    expect(workArea.height - visibleBottom).toBeGreaterThanOrEqual(HUD_DOT_SAFE_MARGIN);
  });

  it('keeps the safe inset on a secondary display with an offset origin', () => {
    const second = { x: 1920, y: -200, width: 1280, height: 720 };
    const bounds = computeDotHudBounds({ xRatio: 1, yRatio: 1, workArea: second });
    expect(bounds.x).toBe(second.x + second.width - bounds.width - HUD_DOT_SAFE_MARGIN);
    expect(bounds.y).toBe(second.y + second.height - bounds.height - HUD_DOT_SAFE_MARGIN);
    expect(bounds.x).toBeGreaterThanOrEqual(second.x + HUD_DOT_SAFE_MARGIN);
  });

  it('dispatches one placement call per style', () => {
    expect(
      computeSpeechHudBoundsForStyle({ placement: { style: 'card', corner: 'bottom-right' }, workArea })
    ).toEqual(computeSpeechHudBounds('bottom-right', workArea));
    expect(
      computeSpeechHudBoundsForStyle({ placement: { style: 'card', corner: 'top-left' }, workArea })
    ).toEqual(
      computeSpeechHudBounds('top-left', workArea, { ...speechHudWindowSize('card'), margin: 18 })
    );
    expect(
      computeSpeechHudBoundsForStyle({
        placement: { style: 'edge', edge: { side: 'left', ratio: 0.25 } },
        workArea,
      })
    ).toEqual(computeEdgeHudBounds({ side: 'left', ratio: 0.25, workArea }));
    expect(
      computeSpeechHudBoundsForStyle({
        placement: { style: 'dot', dot: { xRatio: 0.2, yRatio: 0.8 } },
        workArea,
      })
    ).toEqual(computeDotHudBounds({ xRatio: 0.2, yRatio: 0.8, workArea }));
  });

  it('snaps a dropped knob near a landmark and rounds a free one', () => {
    expect(snapHudRatio(0.51)).toBe(0.5);
    expect(snapHudRatio(0.1)).toBe(0.08);
    expect(snapHudRatio(0.9)).toBe(0.92);
    expect(snapHudRatio(0.333)).toBe(0.33);
    expect(snapHudRatio(4)).toBe(1);
  });

  it('finds the nearest corner for a dropped bar', () => {
    const bar = { x: 1200, y: 700, width: 150, height: 32 };
    expect(nearestHudCorner(bar, workArea)).toBe('bottom-right');
    expect(nearestHudCorner({ ...bar, x: 10, y: 10 }, workArea)).toBe('top-left');
  });

  it('round-trips a position through the persisted ratios', () => {
    const edge = computeEdgeHudBounds({ side: 'right', ratio: 0.37, workArea });
    expect(ratioForEdgeBounds(edge, workArea)).toBeCloseTo(0.37, 2);
    const dot = computeDotHudBounds({ xRatio: 0.13, yRatio: 0.82, workArea });
    const dotRatio = ratioForDotBounds(dot, workArea);
    expect(dotRatio.xRatio).toBeCloseTo(0.13, 2);
    expect(dotRatio.yRatio).toBeCloseTo(0.82, 2);
  });
});


describe('HUD transparency policy (plan 58 addendum)', () => {
  it('defaults the textless styles to glass and the bars to the window setting', () => {
    for (const style of ['edge', 'dot'] as const) {
      expect(
        speechHudTransparentFor({ style, look: { transparent: false, source: 'config' }, explicitlySet: false }),
        style
      ).toBe(true);
    }
    for (const style of ['card'] as const) {
      expect(
        speechHudTransparentFor({ style, look: { transparent: false, source: 'config' }, explicitlySet: false }),
        style
      ).toBe(false);
      expect(
        speechHudTransparentFor({ style, look: { transparent: true, source: 'config' }, explicitlySet: true }),
        style
      ).toBe(true);
    }
  });

  it('lets an explicit choice override the textless default', () => {
    expect(
      speechHudTransparentFor({ style: 'edge', look: { transparent: false, source: 'config' }, explicitlySet: true })
    ).toBe(false);
    expect(
      speechHudTransparentFor({ style: 'dot', look: { transparent: false, source: 'env' }, explicitlySet: true })
    ).toBe(false);
    expect(
      speechHudTransparentFor({ style: 'dot', look: { transparent: true, source: 'env' }, explicitlySet: false })
    ).toBe(true);
  });
});

describe('HUD drag + drop (plan 58 addendum)', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  it('moves a corner window freely and clamps it to the work area', () => {
    const origin = { x: 500, y: 500, width: 420, height: 92 };
    expect(dragHudBounds({ style: 'card', origin, dx: 40, dy: -20, workArea })).toEqual({
      x: 540,
      y: 480,
      width: 420,
      height: 92,
    });
    expect(dragHudBounds({ style: 'card', origin, dx: -9999, dy: 9999, workArea })).toEqual({
      x: 0,
      y: 1080 - 92,
      width: 420,
      height: 92,
    });
  });

  it('slides the knob only along its docked edge', () => {
    const origin = { x: 1920 - 40, y: 400, width: 40, height: 88 };
    expect(dragHudBounds({ style: 'edge', origin, dx: -300, dy: 120, workArea, edgeSide: 'right' })).toEqual({
      x: 1920 - 40,
      y: 520,
      width: 40,
      height: 88,
    });
    expect(dragHudBounds({ style: 'edge', origin, dx: 0, dy: 9999, workArea, edgeSide: 'left' })).toEqual({
      x: 0,
      y: 1080 - 88,
      width: 40,
      height: 88,
    });
  });

  it('snaps a dropped knob to a landmark ratio', () => {
    const dropped = { x: 1880, y: 500, width: 40, height: 88 };
    const placement = dropHudPlacement({ style: 'edge', bounds: dropped, workArea, edgeSide: 'right' });
    const travel = workArea.height - dropped.height;
    expect(placement.edge?.side).toBe('right');
    expect(placement.edge?.ratio).toBeCloseTo(Math.round((500 / travel) * 100) / 100, 2);
  });

  it('snaps a dropped bar to the nearest corner and keeps a free dot fraction', () => {
    expect(
      dropHudPlacement({
        style: 'card',
        bounds: { x: 10, y: 800, width: 420, height: 92 },
        workArea,
      })
    ).toEqual({ corner: 'bottom-left' });
    const dot = dropHudPlacement({
      style: 'dot',
      bounds: { x: 480, y: 266, width: 48, height: 48 },
      workArea,
    });
    expect(dot.dot?.xRatio).toBeCloseTo(0.25, 2);
    expect(dot.dot?.yRatio).toBeCloseTo(0.25, 2);
  });
});
