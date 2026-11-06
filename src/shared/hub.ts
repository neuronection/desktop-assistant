import { TEXT } from '@shared/constants/text';

/** The curated hub actions (plan 65). No arbitrary commands or scripts. */
export const HUB_ACTION_IDS = [
  'live-toggle',
  'translate-selection',
  'speak-selection',
  'dictate',
  'open-assistant',
  'hide-hub',
] as const;

export type HubActionId = (typeof HUB_ACTION_IDS)[number];

export interface HubActionDef {
  id: HubActionId;
  label: string;
  hint: string;
}

export const HUB_ACTIONS: Record<HubActionId, HubActionDef> = {
  'live-toggle': {
    id: 'live-toggle',
    label: TEXT.HUB_ACTION_LIVE,
    hint: TEXT.HUB_ACTION_LIVE_HINT,
  },
  'translate-selection': {
    id: 'translate-selection',
    label: TEXT.HUB_ACTION_TRANSLATE,
    hint: TEXT.HUB_ACTION_TRANSLATE_HINT,
  },
  'speak-selection': {
    id: 'speak-selection',
    label: TEXT.HUB_ACTION_SPEAK,
    hint: TEXT.HUB_ACTION_SPEAK_HINT,
  },
  dictate: {
    id: 'dictate',
    label: TEXT.HUB_ACTION_DICTATE,
    hint: TEXT.HUB_ACTION_DICTATE_HINT,
  },
  'open-assistant': {
    id: 'open-assistant',
    label: TEXT.HUB_ACTION_ASSISTANT,
    hint: TEXT.HUB_ACTION_ASSISTANT_HINT,
  },
  'hide-hub': {
    id: 'hide-hub',
    label: TEXT.HUB_ACTION_HIDE,
    hint: TEXT.HUB_ACTION_HIDE_HINT,
  },
};

export const DEFAULT_HUB_QUICK_ACTIONS: readonly HubActionId[] = [
  'live-toggle',
  'translate-selection',
  'speak-selection',
  'dictate',
  'open-assistant',
  'hide-hub',
];

export const DEFAULT_HUB_TAB_ACTIONS: readonly HubActionId[] = [
  'translate-selection',
  'open-assistant',
];

/** The dot's hover cluster: presence-first, so only session-starting actions. */
export const DEFAULT_HUB_DOT_ACTIONS: readonly HubActionId[] = [
  'speak-selection',
  'dictate',
  'live-toggle',
];

export const HUB_DOT_ACTION_IDS: readonly HubActionId[] = [
  'speak-selection',
  'dictate',
  'live-toggle',
];

export const HUD_PRESETS = ['pulse', 'aurora', 'minimal', 'snake', 'terminal'] as const;
export type HudPreset = (typeof HUD_PRESETS)[number];

export const HUD_CONTROL_MODES = ['auto', 'always'] as const;
export type HudControlMode = (typeof HUD_CONTROL_MODES)[number];

export function isHubActionId(value: unknown): value is HubActionId {
  return typeof value === 'string' && (HUB_ACTION_IDS as readonly string[]).includes(value);
}

/** Auto text dock width: one generous envelope for up to three lines. */
export function autoHubDockWidth(_tabActions: readonly string[] = []): 160 {
  return 160;
}

/** Keep order, drop unknown/duplicate ids, cap the list. */
export function normalizeHubActions(
  value: unknown,
  options: { max: number; exclude?: readonly HubActionId[] } = { max: HUB_ACTION_IDS.length }
): HubActionId[] {
  const excluded = new Set(options.exclude ?? []);
  const seen = new Set<string>();
  const out: HubActionId[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isHubActionId(entry) || seen.has(entry) || excluded.has(entry)) {
        continue;
      }
      seen.add(entry);
      out.push(entry);
      if (out.length >= options.max) {
        break;
      }
    }
  }
  return out;
}

export interface HubActionView extends HubActionDef {
  enabled: boolean;
  reason?: string;
  active?: boolean;
}

export interface HubBusy {
  id: string;
  active: boolean;
}

export interface HubResult {
  id: string;
  kind: 'translation' | 'text' | 'error';
  title: string;
  text: string;
  retryable: boolean;
}
