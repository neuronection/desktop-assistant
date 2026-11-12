import type { HudDraftItem, HudDraftSummary } from '@main/services/capture/HudDraftStore';
import { getHudDraft } from '@main/services/capture/HudDraftStore';
import { IPC } from '@shared/ipc/registry';
import { register } from './register';

export interface HudDraftIpcDeps {
  /** Open the launcher with the waiting capture in the draft (badge click). */
  handOff(item: HudDraftItem): void;
  /** Push the summary to the HUD window (it also asks on mount). */
  broadcast(summary: HudDraftSummary): void;
}

/** The HUD draft surface (plan 80 follow-up): one capture, one badge. */
export function registerHudDraftIpc({ handOff, broadcast }: HudDraftIpcDeps): void {
  getHudDraft().subscribe((summary) => broadcast(summary));

  register(IPC['hud:draft-state'], async () => getHudDraft().summary());
  register(IPC['hud:draft-image'], async () => getHudDraft().peek());
  register(IPC['hud:take-draft'], async () => getHudDraft().take());
  register(IPC['hud:open-draft'], async () => {
    const item = getHudDraft().take();
    if (item) {
      handOff(item);
    }
    return item !== null;
  });
}
