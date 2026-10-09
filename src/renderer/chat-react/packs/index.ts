import { calcRenderer } from './mini-calc';
import { translateRenderer } from './mini-translate';

/**
 * Renderer-side pack registry (plan 26 Tier 1): each bundled app's
 * interactive binding lives under `packs/<id>/`. Adding a first-party
 * surface = a manifest in `main/apps/packs/<id>/` + a binding here;
 * Tier 2 (imported code packs behind an RPC shim) will reuse this
 * layout as its template.
 */
export const SURFACE_RENDERER_BINDINGS = [calcRenderer, translateRenderer];
