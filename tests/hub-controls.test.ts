import { describe, it, expect } from 'vitest';
import {
  HUB_DOCK_ACTION_IDS,
  HUB_PAGE_SIZE,
  resolveHubControls,
} from '@shared/hubControls';

const context = { surface: 'dock' as const, audio: false, live: false, selection: false, busy: false };

describe('hub control manifest (plan 66)', () => {
  it('keeps the fixed dock minimal', () => {
    expect(resolveHubControls(context).map((control) => control.id)).toEqual([
      'hub',
      'open-assistant',
      'dictate',
      'live-toggle',
    ]);
    expect(HUB_DOCK_ACTION_IDS).toEqual(['translate-selection', 'speak-selection', 'dictate']);
    expect(HUB_PAGE_SIZE).toBe(4);
  });

  it('swaps the dock for send and stop while dictating', () => {
    expect(
      resolveHubControls({ ...context, dictating: true, stop: true }).map((control) => control.id)
    ).toEqual(['hub', 'dictate-send', 'stop']);
  });

  it('offers a stop control while a HUD quick question is working', () => {
    expect(
      resolveHubControls({ ...context, working: true }).map((control) => control.id)
    ).toEqual(['hub', 'stop-turn']);
  });

  it('adds pause/stop only for active speech', () => {
    expect(
      resolveHubControls({ ...context, audio: true, stop: true }).map((control) => control.id)
    ).toEqual(['hub', 'pause', 'stop']);
  });

  it('hides open-assistant during sessions and dictation', () => {
    expect(resolveHubControls({ ...context, audio: true }).map((control) => control.id)).not.toContain('open-assistant');
    expect(resolveHubControls({ ...context, live: true }).map((control) => control.id)).not.toContain('open-assistant');
    expect(resolveHubControls({ ...context, dictating: true }).map((control) => control.id)).not.toContain('open-assistant');
  });

  it('replaces speech controls with interrupt/end during live', () => {
    expect(
      resolveHubControls({ ...context, live: true }).map((control) => control.id)
    ).toEqual(['hub', 'interrupt', 'end-live']);
  });

  it('offers the dot cluster only the session-starting actions', () => {
    const dot = { ...context, surface: 'dot' as const };
    expect(resolveHubControls(dot).map((control) => control.id).sort()).toEqual(['dictate', 'live-toggle']);
    expect(
      resolveHubControls({ ...dot, selection: true }).map((control) => control.id).sort()
    ).toEqual(['dictate', 'live-toggle', 'speak-selection']);
  });

  it('clears the dot cluster during sessions and dictation', () => {
    const dot = { ...context, surface: 'dot' as const, selection: true };
    expect(resolveHubControls({ ...dot, audio: true }).map((control) => control.id)).toEqual([]);
    expect(resolveHubControls({ ...dot, live: true }).map((control) => control.id)).toEqual([]);
    expect(resolveHubControls({ ...dot, dictating: true }).map((control) => control.id)).toEqual([]);
  });

  it('adds selection actions to the dock only when text is available', () => {
    expect(resolveHubControls({ ...context, selection: true }).map((control) => control.id)).toEqual([
      'hub',
      'open-assistant',
      'dictate',
      'live-toggle',
      'translate-selection',
      'speak-selection',
    ]);
  });

  it('hides selection actions without a selection', () => {
    const without = resolveHubControls({ ...context, surface: 'popover' }).map((control) => control.id);
    expect(without).not.toContain('translate-selection');
    expect(without).not.toContain('speak-selection');
    const withSelection = resolveHubControls({
      ...context,
      surface: 'popover',
      selection: true,
    }).map((control) => control.id);
    expect(withSelection).toContain('translate-selection');
    expect(withSelection).toContain('speak-selection');
    expect(resolveHubControls(context).map((control) => control.id)).not.toContain('translate-selection');
    expect(resolveHubControls(context).map((control) => control.id)).toContain('dictate');
  });
});
