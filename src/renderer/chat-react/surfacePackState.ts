/**
 * Surface-pack registry state (plan 26): the mini-app registry is the
 * single source of truth for which surface packs exist and are
 * enabled. Leaf module — pack bindings and the mode controller both
 * read it; a successful registry read is authoritative (zero surface
 * packs = zero launcher modes).
 */

import type { MiniAppView } from '@shared/app-pack';

export interface SurfacePackState {
  title: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** Pack ids this build knows renderers for — populated by the renderer registry import. */
export let boundPackIds: readonly string[] = [];

export function setBoundPackIds(ids: readonly string[]): void {
  boundPackIds = ids;
}

let packStates: Record<string, SurfacePackState> = {};
let fetched = false;

export function setSurfacePackViews(views: MiniAppView[], master: boolean): void {
  const next: Record<string, SurfacePackState> = {};
  for (const view of views) {
    if (view.kind === 'surface' && boundPackIds.includes(view.id)) {
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

/** The pack's registry title (manifest i18n) — the single source for display names. */
export function surfacePackTitle(packId: string): string {
  return packStates[packId]?.title ?? packId;
}
