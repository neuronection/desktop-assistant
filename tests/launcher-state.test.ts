import { describe, it, expect } from 'vitest';
import { initialLauncherState, launcherReducer, formatDuration, phaseLabel } from '@renderer/chat-react/launcherState';
import type { TurnTraceStep } from '@shared/turns';

describe('launcherReducer', () => {
  it('walks the happy path idle → thinking → responding → done', () => {
    let state = initialLauncherState;
    state = launcherReducer(state, { type: 'send' });
    expect(state).toEqual({ ui: 'thinking', base: 'idle' });
    state = launcherReducer(state, { type: 'first_delta' });
    expect(state.ui).toBe('responding');
    state = launcherReducer(state, { type: 'turn_finished' });
    expect(state).toEqual({ ui: 'done', base: 'done' });
  });

  it('maps failure to the failed state', () => {
    let state = initialLauncherState;
    state = launcherReducer(state, { type: 'send' });
    state = launcherReducer(state, { type: 'first_delta' });
    state = launcherReducer(state, { type: 'turn_failed' });
    expect(state).toEqual({ ui: 'failed', base: 'failed' });
  });

  it('expand remembers the live base and collapse returns to it', () => {
    let state = initialLauncherState;
    state = launcherReducer(state, { type: 'send' });
    state = launcherReducer(state, { type: 'first_delta' });
    state = launcherReducer(state, { type: 'toggle_expand' });
    expect(state).toEqual({ ui: 'expanded', base: 'responding' });
    state = launcherReducer(state, { type: 'turn_finished' });
    expect(state).toEqual({ ui: 'expanded', base: 'done' });
    state = launcherReducer(state, { type: 'collapse' });
    expect(state.ui).toBe('done');
  });

  it('auto_expand never collapses and is a no-op when already expanded', () => {
    let state = launcherReducer(initialLauncherState, { type: 'send' });
    state = launcherReducer(state, { type: 'auto_expand' });
    expect(state.ui).toBe('expanded');
    state = launcherReducer(state, { type: 'auto_expand' });
    expect(state.ui).toBe('expanded');
    state = launcherReducer(state, { type: 'collapse' });
    expect(state.ui).toBe('thinking');
  });

  it('dismiss resets to idle', () => {
    let state = launcherReducer(initialLauncherState, { type: 'send' });
    state = launcherReducer(state, { type: 'turn_finished' });
    state = launcherReducer(state, { type: 'dismiss' });
    expect(state).toEqual(initialLauncherState);
  });

  it('hiding keeps active turns and dismisses finished responses', () => {
    let active = launcherReducer(initialLauncherState, { type: 'send' });
    active = launcherReducer(active, { type: 'window_hidden' });
    expect(active.ui).toBe('thinking');

    let finished = launcherReducer(initialLauncherState, { type: 'send' });
    finished = launcherReducer(finished, { type: 'turn_finished' });
    finished = launcherReducer(finished, { type: 'window_hidden' });
    expect(finished).toEqual(initialLauncherState);

    let failed = launcherReducer(initialLauncherState, { type: 'send' });
    failed = launcherReducer(finished, { type: 'turn_failed' });
    failed = launcherReducer(failed, { type: 'window_hidden' });
    expect(failed).toEqual(initialLauncherState);
  });

  it('hiding while expanded collapses to the base, dismissing terminal bases', () => {
    let state = launcherReducer(initialLauncherState, { type: 'send' });
    state = launcherReducer(state, { type: 'toggle_expand' });
    state = launcherReducer(state, { type: 'window_hidden' });
    expect(state.ui).toBe('thinking');

    state = launcherReducer(state, { type: 'toggle_expand' });
    state = launcherReducer(state, { type: 'turn_finished' });
    state = launcherReducer(state, { type: 'window_hidden' });
    expect(state).toEqual(initialLauncherState);
  });

  it('a turn finished while hidden survives re-summoning until the next hide', () => {
    let state = launcherReducer(initialLauncherState, { type: 'send' });
    state = launcherReducer(state, { type: 'window_hidden' });
    state = launcherReducer(state, { type: 'turn_finished' });
    expect(state.ui).toBe('done');
    state = launcherReducer(state, { type: 'window_hidden' });
    expect(state.ui).toBe('idle');
  });

  it('is idempotent for repeated terminal signals', () => {
    let state = launcherReducer(initialLauncherState, { type: 'send' });
    state = launcherReducer(state, { type: 'turn_finished' });
    state = launcherReducer(state, { type: 'turn_finished' });
    state = launcherReducer(state, { type: 'first_delta' });
    expect(state.ui).toBe('done');

    let idle = launcherReducer(initialLauncherState, { type: 'turn_finished' });
    expect(idle.ui).toBe('idle');
  });

  it('toggle_expand from idle collapses back to idle', () => {
    let state = launcherReducer(initialLauncherState, { type: 'toggle_expand' });
    expect(state).toEqual({ ui: 'expanded', base: 'idle' });
    state = launcherReducer(state, { type: 'toggle_expand' });
    expect(state.ui).toBe('idle');
  });
});

describe('phaseLabel', () => {
  const thinking: TurnTraceStep = { id: 't1', phase: 'thinking', label: 'Thinking', startedAt: 0 };

  it('stays coarse while steps run — raw step and node labels never surface', () => {
    expect(phaseLabel('thinking', [thinking])).toBe('Thinking');
    expect(
      phaseLabel('thinking', [{ id: 'n1', phase: 'thinking', label: 'HumanInTheLoopMiddleware.after_model', startedAt: 0 }])
    ).toBe('Thinking');
    expect(
      phaseLabel('streaming', [{ ...thinking, endedAt: 5 }, { id: 't2', phase: 'tool_call', label: 'Searching', startedAt: 6, toolName: 'web_search' }])
    ).toBe('Working');
  });

  it('reports streaming while deltas flow, even with the model node step still open', () => {
    expect(phaseLabel('streaming', [{ ...thinking, endedAt: undefined }])).toBe('Streaming');
  });

  it('falls back to the phase word', () => {
    expect(phaseLabel('queued', [])).toBe('Queued');
    expect(phaseLabel('streaming', [{ ...thinking, endedAt: 5 }])).toBe('Streaming');
    expect(phaseLabel(null, [])).toBe('Thinking');
  });
});

describe('formatDuration', () => {
  it('formats ms below a second and seconds above', () => {
    expect(formatDuration(120)).toBe('120ms');
    expect(formatDuration(1400)).toBe('1.4s');
    expect(formatDuration(14200)).toBe('14s');
  });
});
