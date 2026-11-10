import type { CommandEntry } from '@shared/commands';
import type { AppConfig } from '@shared/config/AppConfig';
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
  /** The pack's display name (`Translate`) — the route rides `route`, never the name. */
  title: string;
  /** Pack-shaped display direction for the mode bar (`en → el`) — null when the pack has none. */
  route?: string | null;
  icon: typeof import('lucide-react').Calculator;
  accent: string;
  placeholder: string;
  hint: string;
  /** Translate pad (plan 19 S6): target code captured at open time; null defers to the pack default / engine default per call. */
  targetCode?: string | null;
  /** Translate pad source code from the launch options (plan 53); null = auto-detect. */
  sourceCode?: string | null;
  /** Translate pad engine override ('inherit' | 'auto' | 'service' | 'llm') from its Settings menu. */
  engineMode?: string | null;
}

/** What a pack binding gets when shaping an open/live update — its own config plus the app config. */
export interface SurfaceOptionContext {
  packConfig: Record<string, unknown>;
  config: AppConfig | null;
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
  applyOpenOptions?: (mini: MiniApp, options: MiniAppOpenOptions, context: SurfaceOptionContext) => MiniApp;
  /** Optional mid-session option update (plan 53 S3.4) — apply new launch values to the LIVE surface without a remount. */
  applyLiveOptions?: (mini: MiniApp, options: MiniAppOpenOptions, context: SurfaceOptionContext) => MiniApp;
  /** The live surface's current values keyed by launch-option id — the in-pad menu opens pre-filled (plan 69). */
  liveOptionValues?: (mini: MiniApp) => MiniAppOpenOptions;
  /** The pack's one-click direction swap (plan 70); null = the current state has no reverse. */
  swapOptions?: (mini: MiniApp) => MiniAppOpenOptions | null;
  /** A pack-owned footer link in its options menu (e.g. the translation engine settings). */
  optionsFooter?: (mini: MiniApp) => { label: string; onClick: () => void } | null;
  /** The pack's live behavior for the current input — owned by the pack module, not the controller. */
  useLive?: (app: MiniApp | null, input: string, config: unknown) => SurfaceLiveState | null;
}

/** A live row a surface renders under its mode bar (generic — no per-app branches). */
export type SurfaceLiveRow =
  | { kind: 'result'; variant: 'compact' | 'card'; label: string; value: string; meta?: string; speak?: string }
  | { kind: 'pending'; label: string }
  | { kind: 'error'; message: string; retry?: () => void };

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

/** Resolves the mini-app pack a command entry launches (plan 53 S3) — host ids only, no pack table. */
export function packIdForEntry(entry: CommandEntry): string | null {
  if (entry.id.startsWith('miniapp:run:')) {
    return entry.id.slice('miniapp:run:'.length) || null;
  }
  if (entry.id.startsWith('miniapp:cmd:')) {
    const rest = entry.id.slice('miniapp:cmd:'.length);
    const separator = rest.indexOf(':');
    return separator > 0 ? rest.slice(0, separator) : null;
  }
  return bindingForEntry(entry)?.packId ?? null;
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
  /** Pack-declared launch values keyed by option id (plan 53) — pack bindings interpret their own ids. */
  [optionId: string]: string | number | boolean | null | undefined;
}

export function miniAppForEntry(entry: CommandEntry, options: MiniAppOpenOptions = {}, config: AppConfig | null = null): MiniApp | null {
  const binding = bindingForEntry(entry);
  if (!binding || !surfacePackEnabled(binding.packId)) {
    return null;
  }
  const mini = miniAppForId(binding.modeId);
  if (!mini) {
    return null;
  }
  if (binding.applyOpenOptions) {
    return binding.applyOpenOptions(mini, options, { packConfig: surfacePackConfig(binding.packId), config });
  }
  return mini;
}

/** Launch-option values for the live surface, so its menu edits what is on screen rather than the stored defaults. */
export function liveOptionValuesFor(mini: MiniApp): MiniAppOpenOptions {
  const binding = SURFACE_RENDERER_BINDINGS.find((candidate) => candidate.modeId === mini.id);
  return binding?.liveOptionValues?.(mini) ?? {};
}

/** The pack's reverse direction for a one-click swap, or null when the current state has no mirror. */
export function swapOptionsFor(mini: MiniApp): MiniAppOpenOptions | null {
  const binding = SURFACE_RENDERER_BINDINGS.find((candidate) => candidate.modeId === mini.id);
  return binding?.swapOptions?.(mini) ?? null;
}

/** The pack's own settings deep link for its options menu, when it declares one. */
export function optionsFooterFor(mini: MiniApp): { label: string; onClick: () => void } | null {
  const binding = SURFACE_RENDERER_BINDINGS.find((candidate) => candidate.modeId === mini.id);
  return binding?.optionsFooter?.(mini) ?? null;
}

export function miniAppForLiveOptions(
  entry: CommandEntry,
  current: MiniApp,
  options: MiniAppOpenOptions,
  config: AppConfig | null = null
): MiniApp | null {
  const binding = bindingForEntry(entry);
  if (!binding || !surfacePackEnabled(binding.packId)) {
    return null;
  }
  const apply = binding.applyLiveOptions ?? binding.applyOpenOptions;
  return apply ? apply(current, options, { packConfig: surfacePackConfig(binding.packId), config }) : null;
}
