import type { CommandEntry } from '@shared/commands';
import { setBoundPackIds, surfacePackConfig, surfacePackEnabled, surfacePackTitle } from './surfacePackState';
import { SURFACE_RENDERER_BINDINGS } from '@packs/renderer';

setBoundPackIds(SURFACE_RENDERER_BINDINGS.map((binding) => binding.packId));

/**
 * Mini-app modes (plan 14 §9; pack-driven since plan 26): launcher
 * input takeovers DECLARED by installed surface packs and rendered by
 * host-owned Tier-1 contribution bindings (`src/packs/<id>/renderer.ts`,
 * bundled code keyed by pack id). The pack is the source of truth —
 * enabled state, title and pad config come from the mini-app registry;
 * before the first successful registry read no modes engage (the
 * palette row executes the command normally).
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
  /** The pack's live behavior for the current input — owned by the pack module, not the controller. */
  useLive?: (app: MiniApp | null, input: string, config: unknown) => SurfaceLiveState | null;
}

/** A live row a surface renders under its mode bar (generic — no per-app branches). */
export type SurfaceLiveRow =
  | { kind: 'result'; variant: 'compact' | 'card'; label: string; value: string; meta?: string }
  | { kind: 'pending'; label: string }
  | { kind: 'error'; message: string };

export interface SurfaceLiveState {
  /** What copy-on-Enter/click copies; null while nothing is ready. */
  copyValue: string | null;
  rows: SurfaceLiveRow[];
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
      return {
        id,
        packId: binding.packId,
        title: surfacePackTitle(binding.packId),
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
