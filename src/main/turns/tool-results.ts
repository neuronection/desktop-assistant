import type { ToolResultView } from '@shared/turns';

export type StoredToolResult = Omit<ToolResultView, 'callId'>;

const STORE_CAP = 64;

interface WireImageBlock {
  type: 'image';
  source_type?: string;
  data?: unknown;
  url?: unknown;
  mime_type?: unknown;
}

function isImageBlock(block: unknown): block is WireImageBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'image';
}

/** Pulls viewable text + data-URL images out of a raw ToolMessage content. */
export function extractStoredResult(content: unknown): { text: string; images: string[] } {
  if (typeof content === 'string') {
    return { text: content, images: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', images: [] };
  }
  const texts: string[] = [];
  const images: string[] = [];
  for (const block of content) {
    if (isImageBlock(block)) {
      if (block.source_type === 'base64' && typeof block.data === 'string') {
        images.push(`data:${typeof block.mime_type === 'string' ? block.mime_type : 'image/png'};base64,${block.data}`);
      } else if (typeof block.url === 'string' && block.url.startsWith('data:')) {
        images.push(block.url);
      }
      continue;
    }
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      texts.push((block as { text: string }).text);
    }
  }
  return { text: texts.join('\n'), images };
}

/**
 * L1 hot-path cache in front of the durable ToolResultService — the
 * most recent tool results without a disk/DB round-trip.
 */
export class ToolResultStore {
  private readonly entries = new Map<string, StoredToolResult>();

  put(callId: string, result: StoredToolResult): void {
    if (this.entries.size >= STORE_CAP) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.delete(callId);
    this.entries.set(callId, result);
  }

  get(callId: string): ToolResultView | null {
    const stored = this.entries.get(callId);
    if (!stored) {
      return null;
    }
    this.entries.delete(callId);
    this.entries.set(callId, stored);
    return { callId, ...stored };
  }

  has(callId: string): boolean {
    return this.entries.has(callId);
  }

  clear(): void {
    this.entries.clear();
  }
}
