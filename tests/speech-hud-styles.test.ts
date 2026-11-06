import { describe, it, expect } from 'vitest';
import { LIVE_INITIAL, type LiveSnapshot } from '@shared/live';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import {
  hudPresentation,
  hudVisualFor,
  liveHudVisual,
  resolveHudMode,
  SPEECH_HUD_EDGE_SIDES,
  SPEECH_HUD_SHAPES,
  SPEECH_HUD_STYLES,
  speechHudBox,
  speechHudWindowSize,
  speechKnobGeometry,
  type SpeechHudStyle,
} from '@shared/speechHud';
import { TEXT } from '@shared/constants/text';

const live = (state: LiveSnapshot['state'], patch: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  ...LIVE_INITIAL,
  state,
  ...patch,
});

const speech = (patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot => ({
  ...SPEECH_INITIAL,
  state: 'speaking',
  utteranceId: 1,
  chunkCount: 3,
  chunkIndex: 1,
  ...patch,
});

describe('HUD style geometry (plan 58 addendum)', () => {
  it('declares the visible shape and the glow-padded window per style', () => {
    expect(SPEECH_HUD_STYLES).toEqual(['card', 'edge', 'dot']);
    expect(SPEECH_HUD_EDGE_SIDES).toEqual(['left', 'right', 'top', 'bottom']);
    expect(SPEECH_HUD_SHAPES.card).toEqual({ width: 400, height: 72 });
    expect(SPEECH_HUD_SHAPES.edge).toEqual({ width: 30, height: 68 });
    expect(SPEECH_HUD_SHAPES.dot).toEqual({ width: 28, height: 28 });
    for (const style of SPEECH_HUD_STYLES) {
      const box = speechHudBox(style);
      expect(box.width, style).toBeGreaterThan(SPEECH_HUD_SHAPES[style].width);
      expect(box.height, style).toBeGreaterThan(SPEECH_HUD_SHAPES[style].height);
      expect(speechHudWindowSize(style), style).toEqual({ width: box.width, height: box.height });
    }
  });

  it('uses an exact half-pill radius for every knob dock', () => {
    expect(speechKnobGeometry('right')).toEqual({
      width: 30,
      height: 68,
      borderRadius: '15px 0 0 15px',
    });
    expect(speechKnobGeometry('left').borderRadius).toBe('0 15px 15px 0');
    expect(speechKnobGeometry('top')).toEqual({
      width: 68,
      height: 30,
      borderRadius: '0 0 15px 15px',
    });
    expect(speechKnobGeometry('bottom').borderRadius).toBe('15px 15px 0 0');
  });

  it('widens the dock for text mode without moving its docked edge', () => {
    const right = speechHudBox('edge', 'right', { text: true, width: 160 });
    expect(right.width).toBe(240);
    expect(right.height).toBe(97);
    expect(right.pad).toEqual({ top: 10, right: 0, bottom: 10, left: 10 });

    const top = speechHudBox('edge', 'top', { text: true, width: 160 });
    expect(top.width).toBe(240);
    expect(top.height).toBe(97);
    expect(speechHudWindowSize('edge', 'top', { text: true, width: 160 })).toEqual({
      width: top.width,
      height: top.height,
    });

    const geometry = speechKnobGeometry('right', { text: true, width: 160 });
    expect(geometry).toEqual({
      width: 220,
      height: 77,
      borderRadius: '38.5px 0 0 38.5px',
    });
    expect(speechKnobGeometry('top', { text: true, width: 160 })).toEqual({
      width: 220,
      height: 77,
      borderRadius: '0 0 38.5px 38.5px',
    });
    expect(speechKnobGeometry('bottom', { text: true, width: 160 })).toEqual({
      width: 220,
      height: 77,
      borderRadius: '38.5px 38.5px 0 0',
    });
    expect(speechHudWindowSize('edge', 'bottom', { text: true, width: 160 })).toEqual({
      width: 240,
      height: 97,
    });
    expect(speechKnobGeometry('right', { text: true, width: 30 })).toEqual(
      speechKnobGeometry('right')
    );
  });
});

describe('live → knob visual mapping (plan 58 addendum)', () => {
  it('maps every live phase to one visual', () => {
    expect(liveHudVisual('speaking')).toBe('speaking');
    expect(liveHudVisual('listening')).toBe('listening');
    expect(liveHudVisual('paused')).toBe('paused');
    expect(liveHudVisual('error')).toBe('error');
    for (const state of ['arming', 'transcribing', 'thinking', 'preparing'] as const) {
      expect(liveHudVisual(state), state).toBe('idle');
    }
  });

  it('lets live outrank the bus while it owns the speaker', () => {
    expect(resolveHudMode(live('listening'), speech({ state: 'speaking' }))).toBe('live');
    expect(resolveHudMode(live('speaking'), speech({ state: 'idle' }))).toBe('live');
    expect(resolveHudMode(live('error'), speech({ state: 'idle' }))).toBe('live');
    expect(resolveHudMode(live('idle'), speech({ state: 'speaking' }))).toBe('speech');
    expect(resolveHudMode(null, speech())).toBe('speech');
  });

  it('derives the visual from whichever snapshot is authoritative', () => {
    expect(hudVisualFor('live', live('listening'), speech({ state: 'speaking' }))).toBe('listening');
    expect(hudVisualFor('speech', live('listening'), speech({ state: 'paused' }))).toBe('paused');
    expect(hudVisualFor('speech', null, speech({ state: 'synthesizing' }))).toBe('idle');
  });
});

describe('style-parameterized HUD presentation (plan 58 addendum + live extension)', () => {
  it('makes the card body pause/resume like the knob', () => {
    const view = hudPresentation({ style: 'card', live: null, speech: speech() });
    expect(view).toMatchObject({
      mode: 'speech',
      visual: 'speaking',
      click: 'pause',
      stop: 'stop-speech',
      pauseControl: true,
      showProgress: true,
    });
    expect(view.labels).toMatchObject({ pause: TEXT.SPEECH_PAUSE, resume: TEXT.SPEECH_RESUME, stop: TEXT.SPEECH_STOP });
  });

  it('gives the dot a single stop action and no pause affordance', () => {
    const view = hudPresentation({ style: 'dot', live: null, speech: speech() });
    expect(view).toMatchObject({ click: 'stop-speech', stop: 'none', pauseControl: false, showProgress: false });
    expect(view.labels.body).toBe(TEXT.SPEECH_STOP);
    const paused = hudPresentation({ style: 'dot', live: null, speech: speech({ state: 'paused' }) });
    expect(paused.visual).toBe('paused');
    expect(paused.click).toBe('stop-speech');
  });

  it('makes the knob body pause/resume or stop in speech mode', () => {
    expect(hudPresentation({ style: 'edge', live: null, speech: speech() })).toMatchObject({
      click: 'pause',
      stop: 'stop-speech',
      showProgress: true,
    });
    const paused = hudPresentation({ style: 'edge', live: null, speech: speech({ state: 'paused' }) });
    expect(paused.click).toBe('resume');
    expect(paused.labels.body).toBe(TEXT.SPEECH_RESUME);
    const idle = hudPresentation({ style: 'edge', live: null, speech: speech({ state: 'idle' }) });
    expect(idle.click).toBe('none');
  });

  it('remaps every textless style in live mode (dot end, knob interrupt)', () => {

    const dot = hudPresentation({ style: 'dot', live: live('speaking'), speech: speech({ state: 'idle' }) });
    expect(dot).toMatchObject({ mode: 'live', visual: 'speaking', click: 'end-live', stop: 'none' });
    expect(dot.labels.body).toBe(TEXT.SPEECH_LIVE_END);

    const knob = hudPresentation({ style: 'edge', live: live('speaking'), speech: speech({ state: 'idle' }) });
    expect(knob).toMatchObject({ click: 'interrupt-live', stop: 'end-live' });
  });

  it('flashes red for a live error and hands the surface back when the session ends', () => {
    const failed = hudPresentation({ style: 'edge', live: live('error'), speech: speech({ state: 'idle' }) });
    expect(failed).toMatchObject({ mode: 'live', visual: 'error', click: 'interrupt-live', stop: 'end-live' });

    const reverted = hudPresentation({ style: 'edge', live: live('idle'), speech: speech({ state: 'speaking' }) });
    expect(reverted).toMatchObject({ mode: 'speech', visual: 'speaking', click: 'pause' });
  });

  it('works for every style in both modes', () => {
    for (const style of SPEECH_HUD_STYLES as readonly SpeechHudStyle[]) {
      for (const state of ['listening', 'speaking', 'preparing', 'error'] as const) {
        const view = hudPresentation({ style, live: live(state), speech: speech({ state: 'idle' }) });
        expect(view.mode).toBe('live');
        expect(view.showProgress).toBe(false);
        expect(view.pauseControl).toBe(false);
      }
    }
  });
});
