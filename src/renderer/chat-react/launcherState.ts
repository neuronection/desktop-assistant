import type { TurnPhase, TurnTraceStep } from '@shared/turns';
import { TEXT } from '@shared/constants/text';

export type LauncherUiState = 'idle' | 'thinking' | 'responding' | 'done' | 'failed' | 'expanded';

export type LauncherCollapsedState = 'idle' | 'thinking' | 'responding' | 'done' | 'failed';

export interface LauncherState {
  ui: LauncherUiState;
  base: LauncherCollapsedState;
}

export type LauncherAction =
  | { type: 'send' }
  | { type: 'first_delta' }
  | { type: 'turn_finished' }
  | { type: 'turn_failed' }
  | { type: 'toggle_expand' }
  | { type: 'collapse' }
  | { type: 'auto_expand' }
  | { type: 'dismiss' }
  | { type: 'window_hidden' };

export const initialLauncherState: LauncherState = { ui: 'idle', base: 'idle' };

const TERMINAL_BASES: LauncherCollapsedState[] = ['done', 'failed'];

export function launcherReducer(state: LauncherState, action: LauncherAction): LauncherState {
  switch (action.type) {
    case 'send':
      return { ui: 'thinking', base: 'idle' };
    case 'first_delta':
      if (state.ui === 'thinking') {
        return { ...state, ui: 'responding', base: 'responding' };
      }
      if (state.ui === 'expanded' && state.base === 'thinking') {
        return { ...state, base: 'responding' };
      }
      return state;
    case 'turn_finished':
      if (state.ui === 'thinking' || state.ui === 'responding') {
        return { ui: 'done', base: 'done' };
      }
      if (state.ui === 'expanded' && (state.base === 'thinking' || state.base === 'responding')) {
        return { ...state, base: 'done' };
      }
      return state;
    case 'turn_failed':
      if (state.ui === 'thinking' || state.ui === 'responding') {
        return { ui: 'failed', base: 'failed' };
      }
      if (state.ui === 'expanded' && (state.base === 'thinking' || state.base === 'responding')) {
        return { ...state, base: 'failed' };
      }
      return state;
    case 'toggle_expand':
      if (state.ui === 'expanded') {
        return { ui: state.base, base: state.base };
      }
      return { ui: 'expanded', base: state.ui };
    case 'auto_expand':
      if (state.ui === 'expanded') {
        return state;
      }
      return { ui: 'expanded', base: state.ui };
    case 'collapse':
      if (state.ui !== 'expanded') {
        return state;
      }
      return { ui: state.base, base: state.base };
    case 'dismiss':
      return initialLauncherState;
    case 'window_hidden': {
      if (state.ui === 'expanded') {
        if (TERMINAL_BASES.includes(state.base)) {
          return initialLauncherState;
        }
        return { ui: state.base, base: state.base };
      }
      if (TERMINAL_BASES.includes(state.ui)) {
        return initialLauncherState;
      }
      return state;
    }
    default:
      return state;
  }
}

export function phaseLabel(phase: TurnPhase | null, steps: TurnTraceStep[]): string {
  const active = [...steps].reverse().find((step) => step.endedAt === undefined);
  if (active?.phase === 'tool_call' || active?.phase === 'tool_result') {
    return TEXT.PHASE_WORKING;
  }
  if (phase === 'streaming') {
    return TEXT.PHASE_STREAMING;
  }
  if (active) {
    return TEXT.PHASE_THINKING;
  }
  switch (phase) {
    case 'queued':
      return TEXT.PHASE_QUEUED;
    case 'tool_call':
    case 'tool_result':
      return TEXT.PHASE_WORKING;
    default:
      return TEXT.PHASE_THINKING;
  }
}

export function formatStepDuration(startedAt: number, endedAt: number): string {
  return formatDuration(Math.max(0, endedAt - startedAt));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}
