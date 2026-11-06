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
