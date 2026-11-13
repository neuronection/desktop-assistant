import manifest from './hubControls.json';
import type { HubActionId } from './hub';

export type HubSurface = 'dock' | 'popover' | 'menu' | 'dot';
export type HubControlId =
  | 'hub'
  | 'live-toggle'
  | 'pause'
  | 'stop'
  | 'interrupt'
  | 'end-live'
  | 'dictate-send'
  | 'dictate-cancel'
  | 'stop-turn'
  | HubActionId;

export interface HubControlCondition {
  audio?: boolean;
  live?: boolean;
  selection?: boolean;
  busy?: boolean;
  dictating?: boolean;
  working?: boolean;
  stop?: boolean;
}

export interface HubControlDefinition {
  id: HubControlId;
  surfaces: HubSurface[];
  when?: HubControlCondition;
  priority: number;
  /**
   * Manifest hint only (plan 82): the dock row orders by context, then
   * priority; `hover` controls are the ones a selection promotes.
   */
  layer?: 'primary' | 'hover';
}

export interface HubControlContext {
  surface: HubSurface;
  audio: boolean;
  live: boolean;
  selection: boolean;
  busy: boolean;
  dictating?: boolean;
  working?: boolean;
  stop?: boolean;
}

export const HUB_PAGE_SIZE = manifest.pageSize;
const CONTROLS = manifest.controls as HubControlDefinition[];

function matches(condition: HubControlCondition | undefined, context: HubControlContext): boolean {
  if (!condition) {
    return true;
  }
  if (condition.audio !== undefined && condition.audio !== context.audio) {
    return false;
  }
  if (condition.live !== undefined && condition.live !== context.live) {
    return false;
  }
  if (condition.selection !== undefined && condition.selection !== context.selection) {
    return false;
  }
  if (condition.busy !== undefined && condition.busy !== context.busy) {
    return false;
  }
  if (condition.dictating !== undefined && condition.dictating !== (context.dictating === true)) {
    return false;
  }
  if (condition.working !== undefined && condition.working !== (context.working === true)) {
    return false;
  }
  if (condition.stop !== undefined && condition.stop !== (context.stop === true)) {
    return false;
  }
  return true;
}

/** Hard cap: the dock envelope fits seven 22px controls (six gaps), no more. */
export const HUD_DOCK_BUDGET = 7;

export interface DockRow {
  visible: HubControlDefinition[];
  /** Enabled controls that did not fit: reachable in the grid only. */
  overflow: HubControlDefinition[];
}

/**
 * The HUD dock row (plan 82): ONE continuous strip, capped at what the
 * envelope holds. No second, hidden layer — a visible button is the whole
 * affordance and hiding icons left dead space between the visible ones.
 *
 * Context **promotes** instead of hiding: with a text target, the controls
 * gated on `when.selection` move to the front (translate/speak win the slots)
 * and a resident action steps into the overflow, which the grid lists.
 */
export function dockRow(
  controls: readonly HubControlDefinition[],
  context: HubControlContext
): DockRow {
  const dock = controls.filter((control) => control.surfaces.includes('dock'));
  const hub = dock.filter((control) => control.id === 'hub');
  const rest = dock.filter((control) => control.id !== 'hub');
  const promoted = context.selection
    ? rest.filter((control) => control.when?.selection === true).sort((a, b) => b.priority - a.priority)
    : [];
  const residents = rest
    .filter((control) => !promoted.includes(control))
    .sort((a, b) => b.priority - a.priority);
  const ordered = [...hub, ...promoted, ...residents];
  return {
    visible: ordered.slice(0, HUD_DOCK_BUDGET),
    overflow: ordered.slice(HUD_DOCK_BUDGET),
  };
}

export function controlFor(id: HubControlId): HubControlDefinition | undefined {
  return CONTROLS.find((control) => control.id === id);
}

export function resolveHubControls(context: HubControlContext): HubControlDefinition[] {
  return CONTROLS.filter(
    (control) => control.surfaces.includes(context.surface) && matches(control.when, context)
  ).sort((a, b) => b.priority - a.priority);
}

export function controlAllowedOn(surface: HubSurface, id: HubControlId): boolean {
  return CONTROLS.some((control) => control.id === id && control.surfaces.includes(surface));
}

export const HUB_DOCK_ACTION_IDS: HubActionId[] = CONTROLS
  .filter(
    (control) =>
      control.surfaces.includes('dock') &&
      ![
        'hub',
        'live-toggle',
        'pause',
        'stop',
        'interrupt',
        'end-live',
        'stop',
        'open-assistant',
        'dictate-send',
        'dictate-cancel',
        'stop-turn',
      ].includes(control.id)
  )
  .map((control) => control.id as HubActionId);
