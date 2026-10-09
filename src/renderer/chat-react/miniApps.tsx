import type { JSX } from 'react';
import type { CommandEntry } from '@shared/commands';
import type { MiniAppView } from '@shared/app-pack';
import { TEXT } from '@shared/constants/text';
import { SURFACE_RENDERER_BINDINGS } from './packs';

/**
 * Mini-app modes (plan 14 §9; pack-driven since plan 26 S8): launcher
 * input takeovers DECLARED by installed surface packs and rendered by
 * host-owned Tier-1 contribution bindings (`packs/<id>/`, bundled code
 * keyed by pack id). The pack is the source of truth — enabled state,
 * title and pad config come from the mini-app registry; the pre-fetch
 * defaults below reproduce the pre-pack state so surfaces work before
 * the first registry fetch (and in tests without the IPC mock).
 */

export interface MiniApp {
  id: string;
  packId: string;
  title: string;
  icon: typeof import('lucide-react').Calculator;
  accent: string;
  placeholder: string;
  hint: string;
  /** Translate pad (plan 19 S6): target code captured at open time; null defers to the pack default / engine default per call. */
  targetCode?: string | null;
}

export interface SurfaceRendererBinding {
  packId: string;
  modeId: string;
  /** How a palette/command entry maps onto this mode — table-driven, no per-app dispatch. */
  match: { action?: string; toolName?: string };
  icon: typeof import('lucide-react').Calculator;
  placeholder: string;
  hint: string;
  /** Optional pack-specific open-time shaping (e.g. the pad's target code) — lives in the pack module. */
  applyOpenOptions?: (mini: MiniApp, options: MiniAppOpenOptions, config: Record<string, unknown>) => MiniApp;
}

interface SurfacePackState {
  title: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

let packStates: Record<string, SurfacePackState> = {};
let fetched = false;

/**
 * Adopts the registry's surface-pack views (enabled ∧ master). The
 * registry is the single source of truth: before the first successful
 * fetch no launcher modes exist (the palette row simply executes the
 * command normally); a successful read is authoritative — zero
 * installed surface packs means zero modes (uninstall is real).
 */
export function setSurfacePackViews(views: MiniAppView[], master: boolean): void {
  const next: Record<string, SurfacePackState> = {};
  for (const view of views) {
    if (view.kind === 'surface' && SURFACE_RENDERER_BINDINGS.some((binding) => binding.packId === view.id)) {
      next[view.id] = { title: view.title, enabled: view.enabled && master, config: view.configValues ?? {} };
    }
  }
  fetched = true;
  packStates = next;
}

export function surfacePacksFetched(): boolean {
  return fetched;
}

export function surfacePackEnabled(packId: string): boolean {
  return packStates[packId]?.enabled ?? false;
}

export function surfacePackConfig(packId: string): Record<string, unknown> {
  return packStates[packId]?.config ?? {};
}

function bindingForEntry(entry: CommandEntry): SurfaceRendererBinding | null {
  return (
    SURFACE_RENDERER_BINDINGS.find(
      (binding) =>
        (binding.match.action !== undefined && entry.action === binding.match.action) ||
        (binding.match.toolName !== undefined && entry.toolName === binding.match.toolName)
    ) ?? null
  );
}

export function miniAppForId(id: string): MiniApp | null {
  for (const binding of SURFACE_RENDERER_BINDINGS) {
    if (binding.modeId === id && surfacePackEnabled(binding.packId)) {
      const state = packStates[binding.packId];
      return {
        id,
        packId: binding.packId,
        title: state.title,
        icon: binding.icon,
        accent: 'var(--as-primary)',
        placeholder: binding.placeholder,
        hint: binding.hint,
      };
    }
  }
  return null;
}

export interface MiniAppOpenOptions {
  targetCode?: string | null;
}

export function miniAppForEntry(entry: CommandEntry, options: MiniAppOpenOptions = {}): MiniApp | null {
  const binding = bindingForEntry(entry);
  if (!binding || !surfacePackEnabled(binding.packId)) {
    return null;
  }
  const mini = miniAppForId(binding.modeId);
  if (!mini) {
    return null;
  }
  if (binding.applyOpenOptions) {
    return binding.applyOpenOptions(mini, options, surfacePackConfig(binding.packId));
  }
  return mini;
}

export function MiniAppIcon({ app }: { app: MiniApp }): JSX.Element {
  const Icon = app.icon;
  return <Icon className="h-3.5 w-3.5" aria-hidden />;
}
