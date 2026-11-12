import { randomUUID } from 'node:crypto';

export interface ViewerImage {
  token: string;
  dataUrl: string;
  title: string;
  /** The chat window that opened it (edits go back there). */
  openerId: number | null;
  editable: boolean;
}

const MAX_ENTRIES = 6;
const DATA_URL_PREFIX = 'data:image/';

/**
 * The image viewer's payload shelf (plan 80 viewer note). A draft attachment
 * has no `ToolResult` row to fetch by id, so the opener parks the data URL
 * here under a short token and the window fetches it by token — reload-safe,
 * and the open call stays small.
 */
export class ImageViewerStore {
  private readonly items = new Map<string, ViewerImage>();

  constructor(private readonly limit: number = MAX_ENTRIES) {}

  public static isImageDataUrl(value: string): boolean {
    return value.startsWith(DATA_URL_PREFIX);
  }

  public put(input: Omit<ViewerImage, 'token'>): ViewerImage {
    const entry: ViewerImage = {
      token: randomUUID(),
      dataUrl: input.dataUrl,
      title: input.title,
      openerId: input.openerId ?? null,
      editable: input.editable === true,
    };
    this.items.set(entry.token, entry);
    while (this.items.size > this.limit) {
      const oldest = this.items.keys().next();
      if (oldest.done) {
        break;
      }
      this.items.delete(oldest.value);
    }
    return entry;
  }

  public get(token: string): ViewerImage | null {
    return this.items.get(token) ?? null;
  }

  /** An edit replaces the parked payload, so a reload shows the applied image. */
  public update(token: string, patch: { dataUrl: string; title?: string }): ViewerImage | null {
    const entry = this.items.get(token);
    if (!entry) {
      return null;
    }
    const next: ViewerImage = { ...entry, dataUrl: patch.dataUrl, ...(patch.title ? { title: patch.title } : {}) };
    this.items.set(token, next);
    return next;
  }

  public clear(): void {
    this.items.clear();
  }

  public size(): number {
    return this.items.size;
  }
}

let shared: ImageViewerStore | null = null;

export function getImageViewerStore(): ImageViewerStore {
  if (!shared) {
    shared = new ImageViewerStore();
  }
  return shared;
}
