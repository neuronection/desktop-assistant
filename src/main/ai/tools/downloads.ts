import { randomUUID } from 'crypto';

export type DownloadStatus = 'active' | 'done' | 'cancelled' | 'failed';

export interface DownloadProgress {
  downloadId: string;
  destination: string;
  loadedBytes: number;
  totalBytes: number | null;
  status: DownloadStatus;
}

export type DownloadListener = (progress: DownloadProgress) => void;

export interface DownloadHandle {
  id: string;
  destination: string;
  signal: AbortSignal;
  report(loadedBytes: number, totalBytes: number | null): void;
  finish(status: Exclude<DownloadStatus, 'active'>): void;
}

/**
 * Main-process registry of in-flight `download_file` transfers. The tool
 * reports byte progress; TurnManager subscribes to mirror progress into
 * the trace step and the renderer cancels via `cancel()` (IPC). Turn
 * cancellation calls `cancelAll()`.
 */
export class DownloadTracker {
  private readonly active = new Map<string, { destination: string; controller: AbortController }>();
  private readonly listeners = new Set<DownloadListener>();

  begin(destination: string): DownloadHandle {
    const id = randomUUID();
    const controller = new AbortController();
    this.active.set(id, { destination, controller });
    let settled = false;
    const emit = (status: DownloadStatus, loadedBytes: number, totalBytes: number | null): void => {
      const event: DownloadProgress = { downloadId: id, destination, loadedBytes, totalBytes, status };
      this.listeners.forEach((listener) => listener(event));
    };
    emit('active', 0, null);
    return {
      id,
      destination,
      signal: controller.signal,
      report: (loadedBytes, totalBytes) => {
        if (!settled) {
          emit('active', loadedBytes, totalBytes);
        }
      },
      finish: (status) => {
        if (settled) {
          return;
        }
        settled = true;
        this.active.delete(id);
        emit(status, 0, null);
      },
    };
  }

  cancel(downloadId: string): boolean {
    const entry = this.active.get(downloadId);
    if (!entry) {
      return false;
    }
    entry.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const entry of this.active.values()) {
      entry.controller.abort();
    }
  }

  subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.cancelAll();
    this.active.clear();
    this.listeners.clear();
  }
}

export const downloads = new DownloadTracker();
