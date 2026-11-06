// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { SPEECH_INITIAL, type SpeechSnapshot } from '@shared/speech';
import { LIVE_INITIAL, type LiveSnapshot } from '@shared/live';
import { TEXT } from '@shared/constants/text';
import { SpeechHud } from '@renderer/speech-overlay-react/SpeechHud';

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', { configurable: true, value: () => {} });
});

afterEach(cleanup);

function mockDragApi(): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    beginSpeechHudDrag: vi.fn(),
    moveSpeechHudDrag: vi.fn(),
    endSpeechHudDrag: vi.fn(),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return api;
}

function mockNavApi(): {
  menu: ReturnType<typeof vi.fn>;
  openAssistant: ReturnType<typeof vi.fn>;
  openHub: ReturnType<typeof vi.fn>;
  runQuick: ReturnType<typeof vi.fn>;
} {
  const api = {
    openSpeechHudMenu: vi.fn(),
    openHudAssistant: vi.fn(),
    openHub: vi.fn(),
    runQuickHubAction: vi.fn(),
  };
  window.electronAPI = api as unknown as typeof window.electronAPI;
  return {
    menu: api.openSpeechHudMenu,
    openAssistant: api.openHudAssistant,
    openHub: api.openHub,
    runQuick: api.runQuickHubAction,
  };
}

function drag(element: HTMLElement, dx = 10, dy = 10): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, screenX: 10, screenY: 10 }));
  element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, screenX: 10 + dx, screenY: 10 + dy }));
  element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
}

function speaking(patch: Partial<SpeechSnapshot> = {}): SpeechSnapshot {
  return {
    ...SPEECH_INITIAL,
    state: 'speaking',
    utteranceId: 3,
    chunkIndex: 1,
    chunkCount: 4,
    chunkText: 'The chunk being spoken.',
    ...patch,
  };
}

function live(state: LiveSnapshot['state'], patch: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return { ...LIVE_INITIAL, state, ...patch };
}

function renderHud(
  props: Partial<Parameters<typeof SpeechHud>[0]> & { snapshot: SpeechSnapshot }
): ReturnType<typeof render> {
  const { snapshot, ...rest } = props;
  return render(
    <SpeechHud
      snapshot={snapshot}
      onTogglePause={vi.fn()}
      onStop={vi.fn()}
      onInterruptLive={vi.fn()}
      onEndLive={vi.fn()}
      {...rest}
    />
  );
}

const RULE_EXCLUSIONS: Record<string, string> = {};

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .filter((violation) => !(RULE_EXCLUSIONS[violation.id] && violation.impact !== 'critical'))
    .map((violation) => `${violation.id} (${violation.impact})`)
    .join('\n');
  expect(summary).toBe('');
}

describe('HUD navigation (plan 58 addendum)', () => {
  it('opens the native menu from the dock tab and orb without firing their primary action', () => {
    const api = mockNavApi();
    const onStop = vi.fn();
    const onInterruptLive = vi.fn();
    const onTogglePause = vi.fn();
    const card = renderHud({ snapshot: speaking(), style: 'card', onStop, onInterruptLive });
    fireEvent.contextMenu(screen.getByRole('group', { name: TEXT.SPEECH_HUD_ARIA }));
    expect(api.menu).toHaveBeenCalledTimes(1);
    cleanup();

    const edge = renderHud({ snapshot: speaking(), style: 'edge', onStop, onTogglePause });
    fireEvent.contextMenu(edge.container.querySelector('.sh-knob')!);
    expect(api.menu).toHaveBeenCalledTimes(2);
    cleanup();

    renderHud({ snapshot: speaking(), style: 'dot', onStop });
    fireEvent.contextMenu(screen.getByTestId('speech-hud-dot'));
    expect(api.menu).toHaveBeenCalledTimes(3);
    expect(onStop).not.toHaveBeenCalled();
    expect(onInterruptLive).not.toHaveBeenCalled();
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('gives the card a visible open-assistant button', () => {
    const api = mockNavApi();
    renderHud({ snapshot: speaking() });
    const open = screen.getByRole('button', { name: TEXT.SPEECH_HUD_OPEN_ASSISTANT });
    open.click();
    expect(api.openAssistant).toHaveBeenCalledTimes(1);
  });

  it('opens the menu from the card where the DOM receives the event', () => {
    const api = mockNavApi();
    const { container } = renderHud({ snapshot: speaking() });
    fireEvent.contextMenu(container.querySelector('.sh-card')!);
    expect(api.menu).toHaveBeenCalledTimes(1);
  });
});

describe('conditional playback controls (plan 66 S1)', () => {
  it('does not render playback controls while idle', () => {
    const { container } = renderHud({ snapshot: SPEECH_INITIAL });
    const card = container.querySelector('.sh-card')!;
    expect(card.getAttribute('data-playback-active')).toBe('false');
    expect(container.querySelectorAll('.hud-playback')).toHaveLength(0);
  });

  it('renders active playback', () => {
    const active = renderHud({ snapshot: speaking() });
    expect(active.container.querySelector('.sh-card')!.getAttribute('data-playback-active')).toBe('true');
    expect(active.container.querySelectorAll('.hud-playback')).toHaveLength(2);
  });

  it('does not mark live idle as playback-active', () => {
    const { container } = renderHud({ snapshot: SPEECH_INITIAL, live: live('idle') });
    expect(container.querySelector('.sh-card')!.getAttribute('data-playback-active')).toBe('false');
  });
});

describe('wide dock (plan 65)', () => {
  it('shows state transport controls in the fused rail', () => {
    const idle = renderHud({ snapshot: SPEECH_INITIAL, style: 'edge' });
    expect(idle.container.querySelectorAll('.hud-playback')).toHaveLength(0);
    expect(screen.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE })).toBeTruthy();
    cleanup();

    const active = renderHud({ snapshot: speaking(), style: 'edge' });
    expect(active.container.querySelectorAll('.hud-playback')).toHaveLength(2);
    expect(
      [...active.container.querySelectorAll('.hud-playback')].map((el) => el.getAttribute('aria-label'))
    ).toEqual([TEXT.SPEECH_PAUSE, TEXT.SPEECH_STOP]);
    cleanup();

    const liveView = renderHud({ snapshot: SPEECH_INITIAL, live: live('listening'), style: 'edge' });
    expect(
      [...liveView.container.querySelectorAll('.hud-playback')].map((el) => el.getAttribute('aria-label'))
    ).toEqual([TEXT.SPEECH_LIVE_INTERRUPT, TEXT.HUB_LIVE_END]);
  });

  it('shows translate and speak on the dock only with a text target', () => {
    const api = mockNavApi();
    const { container } = renderHud({ snapshot: SPEECH_INITIAL, style: 'edge', selection: true });
    expect(screen.getByRole('button', { name: TEXT.HUB_ACTION_TRANSLATE })).toBeTruthy();
    expect(screen.getByRole('button', { name: TEXT.HUB_ACTION_SPEAK })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_ACTION_TRANSLATE }));
    expect(api.runQuick).toHaveBeenCalledWith('translate-selection');
    cleanup();
    const none = renderHud({ snapshot: SPEECH_INITIAL, style: 'edge' });
    expect(none.container.querySelectorAll('.sh-knob-actions > button')).toHaveLength(4);
  });

  it('copies the displayed dock text from the hover control', () => {
    const write = vi.fn(async () => true);
    window.electronAPI = { writeToClipboard: write } as unknown as typeof window.electronAPI;
    const { container } = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dock: { text: true, width: 160 },
      dockText: 'Copy this response.',
    });
    expect(container.querySelector('.sh-knob-copy')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_RESULT_COPY }));
    expect(write).toHaveBeenCalledWith('Copy this response.');
  });

  it('uses the fused rail for dictate send and stop while dictating', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dictating: true,
      dock: { text: true, width: 160 },
      dockText: 'Listening…',
      onSendDictation: onSend,
      onCancelDictation: onCancel,
    });
    const knob = container.querySelector('.sh-knob') as HTMLElement;
    expect(knob.getAttribute('data-dictating')).toBe('true');
    expect(knob.style.height).toBe('48px');
    expect(container.querySelectorAll('.sh-knob-actions > button')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: TEXT.HUB_DICTATION_CANCEL })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_DICTATION_SEND }));
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_DICTATION_STOP }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('starts the quick STT question from the dock', () => {
    const api = mockNavApi();
    renderHud({ snapshot: SPEECH_INITIAL, style: 'edge' });
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_ACTION_DICTATE }));
    expect(api.runQuick).toHaveBeenCalledWith('dictate');
  });

  it('shows the latest line and opens the hub from the dock', () => {
    const api = mockNavApi();
    const onTogglePause = vi.fn();
    const { container } = renderHud({
      snapshot: speaking(),
      style: 'edge',
      dock: { text: true, width: 128 },
      dockText: 'Translation ready',
      onTogglePause,
    });
    expect(container.querySelector('.sh-knob')!.getAttribute('data-wide')).toBe('true');
    expect(container.querySelector('.sh-knob-text')?.textContent).toBe('Translation ready');

    const actions = screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-knob-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: TEXT.SPEECH_PAUSE }));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    fireEvent.click(within(actions).getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }));
    expect(api.openHub).toHaveBeenCalledTimes(1);
  });

  it('opens a shown translation instead of pausing when the dock text is clicked', () => {
    const onActivate = vi.fn();
    const onTogglePause = vi.fn();
    renderHud({
      snapshot: speaking(),
      style: 'edge',
      dock: { text: true, width: 128 },
      dockText: 'Hallo Welt',
      onActivateText: onActivate,
      onTogglePause,
    });
    const body = screen.getByRole('button', { name: TEXT.HUB_OPEN_RESULT });
    fireEvent.click(body);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('exposes the live toggle as a pressed-able icon when idle', () => {
    renderHud({ snapshot: SPEECH_INITIAL, style: 'edge' });
    const start = screen.getByRole('button', { name: TEXT.HUB_LIVE_START });
    expect(start.getAttribute('aria-pressed')).toBe('false');
    expect(start.querySelector('svg')).toBeTruthy();
    cleanup();
    renderHud({ snapshot: SPEECH_INITIAL, live: live('listening'), style: 'edge' });
    expect(screen.queryByRole('button', { name: TEXT.HUB_LIVE_START })).toBeNull();
    expect(screen.getByRole('button', { name: TEXT.HUB_LIVE_END })).toBeTruthy();
  });

  it('marks the dock busy for a translating state', () => {
    const { container } = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dock: { text: true, width: 128 },
      dockText: TEXT.HUB_BUSY_TRANSLATING,
      busy: true,
    });
    expect(container.querySelector('.sh-knob')!.getAttribute('data-hub-busy')).toBe('true');
    expect(container.querySelector('.sh-knob-text')?.textContent).toBe(TEXT.HUB_BUSY_TRANSLATING);
    expect((screen.getByTestId('speech-hud-body') as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses compact, single-line and multi-line text faces', () => {
    const empty = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dock: { text: true, width: 160 },
      dockText: '',
    });
    const emptyKnob = empty.container.querySelector('.sh-knob') as HTMLElement;
    expect(emptyKnob.getAttribute('data-content')).toBe('empty');
    expect(emptyKnob.style.height).toBe('25px');
    expect(empty.container.querySelector('.sh-knob-text')).toBeNull();
    cleanup();

    const single = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dock: { text: true, width: 160 },
      dockText: TEXT.LIVE_HUD_LISTENING,
    });
    const singleKnob = single.container.querySelector('.sh-knob') as HTMLElement;
    expect(singleKnob.getAttribute('data-content')).toBe('single');
    expect(singleKnob.style.height).toBe('48px');
    cleanup();

    const multi = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'edge',
      dock: { text: true, width: 160 },
      dockText: 'A long transcript line that needs more than one line of space in the dock.',
    });
    const multiKnob = multi.container.querySelector('.sh-knob') as HTMLElement;
    expect(multiKnob.getAttribute('data-content')).toBe('multi');
    expect(multiKnob.style.height).toBe('77px');
  });

  it('drives the live meter and outer ring from the mic level', () => {
    const { container } = renderHud({
      snapshot: SPEECH_INITIAL,
      live: live('listening'),
      style: 'edge',
      micLevel: 0.72,
    });
    expect((container.querySelector('.hud-stage') as HTMLElement).style.getPropertyValue('--hud-mic-level')).toBe('0.72');
    expect(screen.getByRole('button', { name: TEXT.HUB_LIVE_END })).toBeTruthy();
  });

  it('keeps the compact dock textless', () => {
    const { container } = renderHud({ snapshot: speaking(), style: 'edge', dockText: 'Ignored in compact' });
    expect(container.querySelector('.sh-knob')!.getAttribute('data-wide')).toBe('false');
    expect(screen.queryByText('Ignored in compact')).toBeNull();
    expect(screen.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE })).toBeTruthy();
  });

  it('labels the live state control as End live while a session is active', () => {
    renderHud({
      snapshot: SPEECH_INITIAL,
      live: live('listening'),
      style: 'edge',
    });
    expect(screen.queryByRole('button', { name: TEXT.HUB_LIVE_START })).toBeNull();
    expect(screen.getByRole('button', { name: TEXT.HUB_LIVE_END })).toBeTruthy();
  });
});

describe('dot style (plan 58 addendum)', () => {
  it('is a single stop control for speech', () => {
    const onStop = vi.fn();
    renderHud({ snapshot: speaking(), style: 'dot', onStop });
    const dot = screen.getByRole('button', { name: TEXT.SPEECH_STOP });
    expect(dot.getAttribute('data-visual')).toBe('speaking');
    dot.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('ends the live session while live owns the speaker', () => {
    const onStop = vi.fn();
    const onEndLive = vi.fn();
    const onInterruptLive = vi.fn();
    renderHud({
      snapshot: speaking({ state: 'idle' }),
      live: live('speaking'),
      style: 'dot',
      onStop,
      onEndLive,
      onInterruptLive,
    });
    const dot = screen.getByRole('button', { name: TEXT.SPEECH_LIVE_END });
    expect(dot.getAttribute('data-mode')).toBe('live');
    expect(dot.getAttribute('data-visual')).toBe('speaking');
    dot.click();
    expect(onEndLive).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(onInterruptLive).not.toHaveBeenCalled();
  });

  it('shows the live phase colour and flashes on a live error', () => {
    renderHud({ snapshot: speaking({ state: 'idle' }), live: live('listening'), style: 'dot' });
    expect(screen.getByTestId('speech-hud-dot').getAttribute('data-visual')).toBe('listening');
    cleanup();
    renderHud({ snapshot: speaking({ state: 'idle' }), live: live('error'), style: 'dot' });
    expect(screen.getByTestId('speech-hud-dot').getAttribute('data-visual')).toBe('error');
  });

  it('dims while paused and stays textless', () => {
    const { container } = renderHud({ snapshot: speaking({ state: 'paused' }), style: 'dot' });
    expect(screen.getByTestId('speech-hud-dot').getAttribute('data-visual')).toBe('paused');
    expect(container.textContent?.trim()).toBe('');
  });

  it('has no axe violations', async () => {
    const { container } = renderHud({ snapshot: speaking(), style: 'dot' });
    await expectNoViolations(container);
  });

  it('exposes the configured action cluster while idle', () => {
    const liveToggle = vi.fn();
    window.electronAPI = {
      runQuickHubAction: liveToggle,
    } as unknown as typeof window.electronAPI;
    renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'dot',
      dotActions: ['speak-selection', 'dictate', 'live-toggle'],
      selection: true,
    });
    const wrap = screen.getByTestId('speech-hud-dot-wrap');
    expect(wrap.getAttribute('data-dictating')).toBe('false');
    expect(wrap.querySelector('.sh-orb-actions')!.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: TEXT.HUB_ACTION_SPEAK })).toBeTruthy();
    expect(screen.getByRole('button', { name: TEXT.HUB_ACTION_DICTATE })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_LIVE_START }));
    expect(liveToggle).toHaveBeenCalledWith('live-toggle');
  });

  it('hides cluster actions without a text target and during sessions', () => {
    const idle = renderHud({ snapshot: SPEECH_INITIAL, style: 'dot', dotActions: ['speak-selection', 'dictate', 'live-toggle'] });
    expect(idle.container.querySelector('.sh-orb-actions')!.querySelectorAll('button')).toHaveLength(2);
    cleanup();

    const speakingView = renderHud({ snapshot: speaking(), style: 'dot', dotActions: ['speak-selection', 'dictate', 'live-toggle'] });
    expect(speakingView.container.querySelector('.sh-orb-actions')!.querySelectorAll('button')).toHaveLength(0);
    cleanup();

    const liveView = renderHud({
      snapshot: SPEECH_INITIAL,
      live: live('listening'),
      style: 'dot',
      dotActions: ['speak-selection', 'dictate', 'live-toggle'],
    });
    expect(liveView.container.querySelector('.sh-orb-actions')!.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps the strip open with send and stop while dictating', () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'dot',
      dictating: true,
      dotActions: ['dictate'],
      onSendDictation: onSend,
      onCancelDictation: onCancel,
    });
    const wrap = screen.getByTestId('speech-hud-dot-wrap');
    expect(wrap.getAttribute('data-dictating')).toBe('true');
    const actions = wrap.querySelector('.sh-orb-actions') as HTMLElement;
    fireEvent.click(within(actions).getByRole('button', { name: TEXT.HUB_DICTATION_SEND }));
    fireEvent.click(within(actions).getByRole('button', { name: TEXT.HUB_DICTATION_STOP }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('opens the strip toward screen center from the dot position', () => {
    const left = renderHud({ snapshot: SPEECH_INITIAL, style: 'dot', dotActions: ['dictate'], dotDirection: 'start' });
    expect(left.container.querySelector('.sh-orb-wrap')!.getAttribute('data-dir')).toBe('start');
    cleanup();
    const right = renderHud({ snapshot: SPEECH_INITIAL, style: 'dot', dotActions: ['dictate'], dotDirection: 'end' });
    expect(right.container.querySelector('.sh-orb-wrap')!.getAttribute('data-dir')).toBe('end');
  });

  it('has no axe violations with the cluster open', async () => {
    const { container } = renderHud({
      snapshot: SPEECH_INITIAL,
      style: 'dot',
      dotActions: ['speak-selection', 'dictate', 'live-toggle'],
      selection: true,
    });
    await expectNoViolations(container);
  });
});

describe('card live face (plan 63)', () => {
  it('shows the live state and transcript with interrupt/end and no speech progress', () => {
    renderHud({
      snapshot: speaking({ state: 'idle' }),
      live: live('listening'),
      style: 'card',
      liveTranscript: 'what is on my calendar',
    });
    expect(screen.getByRole('status').textContent).toBe(TEXT.LIVE_HUD_LISTENING);
    expect(screen.getByText('what is on my calendar')).toBeTruthy();
    expect(screen.queryByTestId('speech-hud-track')).toBeNull();
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_PAUSE })).toBeNull();
    const liveActions = screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-actions') as HTMLElement;
    expect(within(liveActions).getByRole('button', { name: TEXT.SPEECH_LIVE_INTERRUPT })).toBeTruthy();
    expect(within(liveActions).getByRole('button', { name: TEXT.SPEECH_LIVE_END })).toBeTruthy();
  });

  it('labels an approval pause and prefers the reply caption', async () => {
    const { container } = renderHud({
      snapshot: speaking({ state: 'idle' }),
      live: live('paused', { reason: 'approval' }),
      style: 'card',
      liveCaption: 'I need to run a tool before answering.',
      liveTranscript: 'book the room',
    });
    expect(screen.getByRole('status').textContent).toBe(TEXT.LIVE_HUD_APPROVAL);
    expect(screen.getByText('I need to run a tool before answering.')).toBeTruthy();
    await expectNoViolations(container);
  });
});

describe('HUD quick-question stop (W8)', () => {
  it('offers a stop control while the turn is working', () => {
    const onCancelTurn = vi.fn();
    renderHud({ snapshot: speaking({ state: 'idle' }), style: 'edge', working: true, onCancelTurn });
    const stop = screen.getByRole('button', { name: TEXT.HUB_TURN_STOP });
    fireEvent.click(stop);
    expect(onCancelTurn).toHaveBeenCalledTimes(1);
  });
});

describe('card style stays the original HUD', () => {
  it('keeps the status line, progress and pause/stop controls', () => {
    renderHud({ snapshot: speaking() });
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('2 of 4')).toBeTruthy();
    expect(screen.getByText('The chunk being spoken.')).toBeTruthy();
    const actions = screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-actions') as HTMLElement;
    expect(within(actions).getByRole('button', { name: TEXT.SPEECH_PAUSE })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: TEXT.SPEECH_STOP })).toBeTruthy();
  });

  it('pauses and resumes from the card body like the knob', () => {
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'card', onTogglePause });
    fireEvent.click(screen.getByTestId('speech-hud-body'));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    cleanup();

    renderHud({ snapshot: speaking({ state: 'paused' }), style: 'card', onTogglePause });
    const body = screen.getByTestId('speech-hud-body');
    expect(body.getAttribute('aria-label')).toBe(TEXT.SPEECH_RESUME);
    fireEvent.click(body);
    expect(onTogglePause).toHaveBeenCalledTimes(2);
  });

  it('pauses from a captured click that lands on the card root', () => {
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'card', onTogglePause });
    const card = screen.getByRole('group', { name: TEXT.SPEECH_HUD_ARIA });
    fireEvent.pointerDown(screen.getByTestId('speech-hud-body'), { pointerId: 7, button: 0 });
    fireEvent.pointerUp(card, { pointerId: 7 });
    fireEvent.click(card);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('ignores a card-root click that did not start on the body', () => {
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'card', onTogglePause });
    const card = screen.getByRole('group', { name: TEXT.SPEECH_HUD_ARIA });
    fireEvent.click(card);
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('interrupts live from the card body', () => {
    const onInterruptLive = vi.fn();
    renderHud({
      snapshot: speaking({ state: 'idle' }),
      live: live('listening'),
      style: 'card',
      onInterruptLive,
    });
    const body = screen.getByTestId('speech-hud-body');
    expect(body.getAttribute('aria-label')).toBe(TEXT.SPEECH_LIVE_INTERRUPT);
    fireEvent.click(body);
    expect(onInterruptLive).toHaveBeenCalledTimes(1);
  });

  it('keeps the body clickable out of the drag seam and drags from anywhere else', () => {
    const api = mockDragApi();
    renderHud({ snapshot: speaking(), style: 'card' });
    const card = screen.getByRole('group', { name: TEXT.SPEECH_HUD_ARIA });
    drag(card);
    expect(api.beginSpeechHudDrag).toHaveBeenCalledTimes(1);

    api.beginSpeechHudDrag.mockClear();
    drag(screen.getByTestId('speech-hud-body'));
    expect(api.beginSpeechHudDrag, 'body drag should begin').toHaveBeenCalledTimes(1);

    api.beginSpeechHudDrag.mockClear();
    const actions = card.querySelector('.sh-actions') as HTMLElement;
    drag(within(actions).getByRole('button', { name: TEXT.SPEECH_PAUSE }));
    expect(api.beginSpeechHudDrag, 'buttons never drag').not.toHaveBeenCalled();
  });

  it('has no axe violations with the clickable body', async () => {
    const { container } = renderHud({ snapshot: speaking(), style: 'card' });
    await expectNoViolations(container);
  });
});


describe('edge knob style (plan 58 addendum)', () => {
  it('pauses/resumes from the body and pins the progress fill', () => {
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'edge', onTogglePause });
    const body = screen.getByTestId('speech-hud-body');
    expect(body.getAttribute('aria-label')).toBe(TEXT.SPEECH_PAUSE);
    body.click();
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('speech-hud-track').getAttribute('data-visible')).toBe('true');
  });

  it('flips the body to resume while paused', () => {
    renderHud({ snapshot: speaking({ state: 'paused' }), style: 'edge' });
    expect(screen.getByTestId('speech-hud-body').getAttribute('aria-label')).toBe(TEXT.SPEECH_RESUME);
  });

  it('interrupts from the body in live and leaves end to the transport wing', () => {
    const onInterruptLive = vi.fn();
    const onEndLive = vi.fn();
    const onTogglePause = vi.fn();
    renderHud({
      snapshot: speaking({ state: 'idle' }),
      live: live('speaking'),
      style: 'edge',
      edgeSide: 'left',
      onInterruptLive,
      onEndLive,
      onTogglePause,
    });
    expect(screen.getByTestId('speech-hud-body').getAttribute('aria-label')).toBe(TEXT.SPEECH_LIVE_INTERRUPT);
    const actions = screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-knob-actions') as HTMLElement;
    expect(within(actions).queryByRole('button', { name: TEXT.SPEECH_LIVE_END })).toBeNull();
    expect(screen.getByTestId('speech-hud-track').getAttribute('data-visible')).toBe('false');

    screen.getByTestId('speech-hud-body').click();
    expect(onInterruptLive).toHaveBeenCalledTimes(1);
    expect(onEndLive).not.toHaveBeenCalled();
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('is textless and docks to the configured side', () => {
    const { container } = renderHud({ snapshot: speaking(), style: 'edge', edgeSide: 'left' });
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('.sh-knob')?.getAttribute('data-side')).toBe('left');
  });

  it('drags along the edge and still distinguishes a click', () => {
    const api = mockDragApi();
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'edge', onTogglePause });
    const body = screen.getByTestId('speech-hud-body');
    drag(body);
    expect(api.beginSpeechHudDrag).toHaveBeenCalledTimes(1);
    expect(api.moveSpeechHudDrag).toHaveBeenCalledWith(20, 20);
    expect(api.endSpeechHudDrag).toHaveBeenCalledTimes(1);

    body.click();
    expect(onTogglePause).not.toHaveBeenCalled();
    body.click();
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('keeps a short press a click and never drags from the inner buttons', () => {
    const api = mockDragApi();
    const onTogglePause = vi.fn();
    renderHud({ snapshot: speaking(), style: 'edge', onTogglePause });
    const body = screen.getByTestId('speech-hud-body');
    drag(body, 1, 1);
    expect(api.beginSpeechHudDrag).not.toHaveBeenCalled();
    body.click();
    expect(onTogglePause).toHaveBeenCalledTimes(1);

    const actions = screen.getByTestId('speech-hud-body').parentElement!.querySelector('.sh-knob-actions') as HTMLElement;
    drag(within(actions).getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }));
    expect(api.beginSpeechHudDrag).not.toHaveBeenCalled();
  });

  it('has no axe violations in both modes', async () => {
    const speechMode = renderHud({ snapshot: speaking(), style: 'edge' });
    await expectNoViolations(speechMode.container);
    cleanup();
    const liveMode = renderHud({ snapshot: speaking({ state: 'idle' }), live: live('listening'), style: 'edge' });
    await expectNoViolations(liveMode.container);
  });
});

describe('dot drag (plan 58 addendum)', () => {
  it('drags the dot without triggering its stop click', () => {
    const api = mockDragApi();
    const onStop = vi.fn();
    renderHud({ snapshot: speaking(), style: 'dot', onStop });
    const dot = screen.getByTestId('speech-hud-dot');
    drag(dot);
    expect(api.beginSpeechHudDrag).toHaveBeenCalledTimes(1);
    dot.click();
    expect(onStop).not.toHaveBeenCalled();
    dot.click();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('drags the dot from the orb but not from the cluster buttons', () => {
    const api = mockDragApi();
    renderHud({ snapshot: SPEECH_INITIAL, style: 'dot', dotActions: ['dictate'], selection: true });
    const orb = screen.getByTestId('speech-hud-dot');
    drag(orb);
    expect(api.beginSpeechHudDrag).toHaveBeenCalledTimes(1);

    api.beginSpeechHudDrag.mockClear();
    const actions = screen.getByTestId('speech-hud-dot-wrap').querySelector('.sh-orb-actions') as HTMLElement;
    drag(within(actions).getByRole('button', { name: TEXT.HUB_ACTION_DICTATE }));
    expect(api.beginSpeechHudDrag).not.toHaveBeenCalled();
  });
});
