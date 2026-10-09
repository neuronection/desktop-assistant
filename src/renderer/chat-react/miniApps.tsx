import type { JSX } from 'react';
import { Calculator, Languages } from 'lucide-react';
import type { CommandEntry } from '@shared/commands';
import type { MiniAppView } from '@shared/app-pack';
import { TEXT } from '@shared/constants/text';

/**
 * Mini-app modes (plan 14 §9; pack-driven since plan 26 S8): launcher
 * input takeovers DECLARED by installed surface packs and rendered by
 * host-owned Tier-1 contribution renderers (bundled code, keyed by pack
 * id). The pack is the source of truth — enabled state, title and pad
 * config come from the mini-app registry; the static fallback below
 * reproduces the pre-pack defaults so surfaces work before the first
 * registry fetch (and in tests without the IPC mock).
 */

export interface MiniApp {
  id: string;
  packId: string;
  title: string;
  icon: typeof Calculator;
  accent: string;
  placeholder: string;
  hint: string;
  /** Translate pad (plan 19 S6): target code captured at open time; null defers to the pack default / engine default per call. */
  targetCode?: string | null;
}

interface SurfaceRenderer {
  modeId: string;
  icon: typeof Calculator;
  placeholder: string;
  hint: string;
}

const SURFACE_RENDERERS: Record<string, SurfaceRenderer> = {
  'mini-calc': {
    modeId: 'calc:evaluate',
    icon: Calculator,
    placeholder: TEXT.COMMAND_MINI_CALC_PLACEHOLDER,
    hint: TEXT.COMMAND_MINI_HINT,
  },
  'mini-translate': {
    modeId: 'tool:translate',
    icon: Languages,
    placeholder: TEXT.COMMAND_MINI_TRANSLATE_PLACEHOLDER,
    hint: TEXT.COMMAND_MINI_TRANSLATE_HINT,
  },
};

interface SurfacePackState {
  title: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

const FALLBACK_STATE: Record<string, SurfacePackState> = {
  'mini-calc': { title: TEXT.COMMAND_MINI_CALC_TITLE, enabled: true, config: {} },
  'mini-translate': { title: TEXT.COMMAND_MINI_TRANSLATE_TITLE, enabled: true, config: {} },
};

let packStates: Record<string, SurfacePackState> = FALLBACK_STATE;
let masterEnabled = true;

/** Adopts the registry's surface-pack views (enabled ∧ master) — called by useMiniApps after each fetch. */
export function setSurfacePackViews(views: MiniAppView[], master: boolean): void {
  masterEnabled = master;
  const next: Record<string, SurfacePackState> = {};
  for (const view of views) {
    if (view.kind === 'surface' && SURFACE_RENDERERS[view.id]) {
      next[view.id] = { title: view.title, enabled: view.enabled && master, config: view.configValues ?? {} };
    }
  }
  packStates = Object.keys(next).length > 0 ? next : FALLBACK_STATE;
}

export function surfacePackEnabled(packId: string): boolean {
  return packStates[packId]?.enabled ?? false;
}

export function surfacePackConfig(packId: string): Record<string, unknown> {
  return packStates[packId]?.config ?? {};
}

export function miniAppForId(id: string): MiniApp | null {
  for (const [packId, renderer] of Object.entries(SURFACE_RENDERERS)) {
    if (renderer.modeId === id && surfacePackEnabled(packId)) {
      const state = packStates[packId];
      return {
        id,
        packId,
        title: state.title,
        icon: renderer.icon,
        accent: 'var(--as-primary)',
        placeholder: renderer.placeholder,
        hint: renderer.hint,
      };
    }
  }
  return null;
}

export interface MiniAppOpenOptions {
  targetCode?: string | null;
}

export function miniAppForEntry(entry: CommandEntry, options: MiniAppOpenOptions = {}): MiniApp | null {
  if (entry.action && entry.action === 'calc:evaluate') {
    return miniAppForId('calc:evaluate');
  }
  if (entry.toolName === 'translate' && surfacePackEnabled('mini-translate')) {
    const config = surfacePackConfig('mini-translate');
    const packDefault = typeof config.defaultTarget === 'string' ? config.defaultTarget.trim().toLowerCase() : '';
    const targetCode = options.targetCode?.trim().toLowerCase() || packDefault || null;
    const renderer = SURFACE_RENDERERS['mini-translate'];
    const state = packStates['mini-translate'];
    return {
      id: 'tool:translate',
      packId: 'mini-translate',
      targetCode,
      title: targetCode ? `${state.title} → ${targetCode}` : state.title,
      icon: renderer.icon,
      accent: 'var(--as-primary)',
      placeholder: renderer.placeholder,
      hint: renderer.hint,
    };
  }
  return null;
}

export function MiniAppIcon({ app }: { app: MiniApp }): JSX.Element {
  const Icon = app.icon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
