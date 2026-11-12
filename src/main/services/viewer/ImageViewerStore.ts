import { randomUUID } from 'node:crypto';

export interface ViewerImage {
  token: string;
  dataUrl: string;
  title: string;
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

  public put(input: { dataUrl: string; title: string }): ViewerImage {
    const entry: ViewerImage = {
      token: randomUUID(),
      dataUrl: input.dataUrl,
      title: input.title,
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
