import { describe, it, expect } from 'vitest';
import {
  HUB_DOCK_ACTION_IDS,
  HUD_DOCK_BUDGET,
  HUB_PAGE_SIZE,
  dockRow,
  resolveHubControls,
  type HubControlDefinition,
} from '@shared/hubControls';

const context = { surface: 'dock' as const, audio: false, live: false, selection: false, busy: false };

describe('hub control manifest (plan 66)', () => {
  it('keeps the fixed dock minimal', () => {
    expect(resolveHubControls(context).map((control) => control.id)).toEqual([
      'hub',
      'open-assistant',
      'dictate',
      'live-toggle',
      'capture-screen',
    ]);
    expect(HUB_DOCK_ACTION_IDS).toEqual(['translate-selection', 'speak-selection', 'dictate', 'capture-screen']);
    expect(HUB_PAGE_SIZE).toBe(4);
  });

  it('adds send and stop while dictating, keeping home', () => {
    expect(
      resolveHubControls({ ...context, dictating: true, stop: true }).map((control) => control.id)
    ).toEqual(['hub', 'open-assistant', 'dictate-send', 'stop']);
  });

  it('offers a stop control while a HUD quick question is working, keeping home', () => {
    expect(
      resolveHubControls({ ...context, working: true }).map((control) => control.id)
    ).toEqual(['hub', 'stop-turn', 'open-assistant']);
  });

  it('adds pause/stop for active speech, keeping home', () => {
    expect(
      resolveHubControls({ ...context, audio: true, stop: true }).map((control) => control.id)
    ).toEqual(['hub', 'open-assistant', 'pause', 'stop']);
  });

  it('keeps home in every state except a live session', () => {
    expect(resolveHubControls({ ...context, audio: true }).map((control) => control.id)).toContain('open-assistant');
    expect(resolveHubControls({ ...context, dictating: true }).map((control) => control.id)).toContain('open-assistant');
    expect(resolveHubControls({ ...context, working: true }).map((control) => control.id)).toContain('open-assistant');
    expect(resolveHubControls({ ...context, live: true }).map((control) => control.id)).not.toContain('open-assistant');
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
      'capture-screen',
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

describe('HUD dock row (plan 82)', () => {
  const dock = (selection: boolean) => resolveHubControls({ ...context, selection });

  it('is one continuous row ordered by priority, capped by the envelope', () => {
    const row = dockRow(dock(false), { ...context, selection: false });
    expect(row.visible.map((control) => control.id)).toEqual([
      'hub',
      'open-assistant',
      'dictate',
      'live-toggle',
      'capture-screen',
    ]);
    expect(row.overflow).toEqual([]);
    expect(row.visible.length).toBeLessThanOrEqual(HUD_DOCK_BUDGET);
  });

  it('promotes translate and speak to the front when text is available', () => {
    const selectionContext = { surface: 'dock' as const, audio: false, live: false, selection: true, busy: false };
    const row = dockRow(dock(true), selectionContext);
    expect(row.visible.slice(0, 3).map((control) => control.id)).toEqual([
      'hub',
      'translate-selection',
      'speak-selection',
    ]);
    expect(row.visible.length).toBeLessThanOrEqual(HUD_DOCK_BUDGET);
  });

  it('parks anything past the budget in the overflow (the grid lists it)', () => {
    const wide: HubControlDefinition[] = Array.from({ length: 9 }, (_, index) => ({
      id: `extra-${index}` as never,
      surfaces: ['dock'],
      priority: 50 - index,
      layer: 'primary',
    }));
    const row = dockRow([...dock(false), ...wide], { ...context, selection: false });
    expect(row.visible).toHaveLength(HUD_DOCK_BUDGET);
    expect(row.overflow.length).toBeGreaterThanOrEqual(7);
    expect(row.overflow.some((control) => control.id.startsWith('extra-'))).toBe(true);
  });
});
