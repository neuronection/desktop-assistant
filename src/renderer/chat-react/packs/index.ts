import { calcRenderer } from './mini-calc';
import { translateRenderer } from './mini-translate';
import type { MiniApp, SurfaceLiveState } from '../miniApps';

/**
 * Renderer-side pack registry (plan 26 Tier 1): each bundled app's
 * interactive binding lives under `packs/<id>/`. Adding a first-party
 * surface = a manifest in `main/apps/packs/<id>/` + a binding here;
 * Tier 2 (imported code packs behind an RPC shim) will reuse this
 * layout as its template.
 */
export const SURFACE_RENDERER_BINDINGS = [calcRenderer, translateRenderer];

/**
 * Runs every binding's live hook in stable order (each returns null
 * unless its pack owns the active mode) and yields the active state —
 * the controller stays generic, behavior lives in pack modules.
 */
export function useLiveSurfaces(app: MiniApp | null, input: string, config: unknown): SurfaceLiveState | null {
  const states = SURFACE_RENDERER_BINDINGS.map((binding) => binding.useLive?.(app?.packId === binding.packId ? app : null, input, config) ?? null);
  return states.find((state) => state !== null) ?? null;
}
