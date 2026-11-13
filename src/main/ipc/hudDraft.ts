import type { HudDraftItem, HudDraftSummary } from '@main/services/capture/HudDraftStore';
import { getHudDraft } from '@main/services/capture/HudDraftStore';
import { IPC } from '@shared/ipc/registry';
import { register } from './register';

export interface HudDraftIpcDeps {
  /** Open the launcher with the waiting capture in the draft (badge click). */
  handOff(item: HudDraftItem | null, text: string): void;
  /** Show the waiting capture in the image viewer. */
  view(item: HudDraftItem): void | Promise<void>;
  /** OCR → translate, OCR → speak, or drop the draft. */
  translate(item: HudDraftItem): Promise<{ ok: boolean; text?: string; error?: string }>;
  speak(item: HudDraftItem): Promise<{ ok: boolean; error?: string }>;
  clear(): void;
  /** Push the summary to the HUD window (it also asks on mount). */
  broadcast(summary: HudDraftSummary): void;
}

/** The HUD draft surface (plan 80 follow-up): one capture, one badge. */
export function registerHudDraftIpc({ handOff, view, translate, speak, clear, broadcast }: HudDraftIpcDeps): void {
  getHudDraft().subscribe((summary) => broadcast(summary));

  register(IPC['hud:draft-state'], async () => getHudDraft().summary());
  register(IPC['hud:draft-image'], async () => getHudDraft().peek());
  register(IPC['hud:draft-translate'], async () => {
    const item = getHudDraft().peek();
    return item ? translate(item) : { ok: false, error: 'no_draft' };
  });
  register(IPC['hud:draft-speak'], async () => {
    const item = getHudDraft().peek();
    return item ? speak(item) : { ok: false, error: 'no_draft' };
  });
  register(IPC['hud:draft-clear'], async () => {
    clear();
    return true;
  });
  register(IPC['hud:view-draft'], async () => {
    const item = getHudDraft().peek();
    if (item) {
      await view(item);
      return true;
    }
    return false;
  });
  register(IPC['hud:take-draft'], async () => getHudDraft().take());
  register(IPC['hud:open-draft'], async (_event, payload?: { text?: string }) => {
    const item = getHudDraft().take();
    const text = payload?.text?.trim() ?? '';
    if (item) {
      handOff(item, text);
    } else if (text) {
      handOff(null, text);
    }
    return item !== null || text.length > 0;
  });
}
