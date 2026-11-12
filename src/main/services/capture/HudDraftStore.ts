import type { CaptureAttachmentMeta } from '@shared/capture';

export interface HudDraftItem {
  dataUrl: string;
  meta: CaptureAttachmentMeta;
}

export interface HudDraftSummary {
  count: number;
  hasImage: boolean;
  label: string | null;
}

/**
 * The HUD's one-item draft (plan 80 follow-up): a capture taken from the knob
 * stays here instead of popping the launcher open, so the HUD can say "one
 * attachment is waiting" and a dictated question can carry it.
 *
 * One item on purpose — the HUD is a glance surface, not a shelf.
 */
export class HudDraftStore {
  private item: HudDraftItem | null = null;
  private readonly listeners = new Set<(summary: HudDraftSummary) => void>();

  public set(item: HudDraftItem): HudDraftSummary {
    this.item = item;
    return this.emit();
  }

  public peek(): HudDraftItem | null {
    return this.item;
  }

  public take(): HudDraftItem | null {
    const item = this.item;
    this.item = null;
    if (item) {
      this.emit();
    }
    return item;
  }

  public summary(): HudDraftSummary {
    return {
      count: this.item ? 1 : 0,
      hasImage: this.item !== null,
      label: this.item?.meta.label ?? null,
    };
  }

  public subscribe(listener: (summary: HudDraftSummary) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): HudDraftSummary {
    const summary = this.summary();
    for (const listener of this.listeners) {
      listener(summary);
    }
    return summary;
  }
}

let shared: HudDraftStore | null = null;

export function getHudDraft(): HudDraftStore {
  if (!shared) {
    shared = new HudDraftStore();
  }
  return shared;
}
