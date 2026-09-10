import type { AppConfig } from '@shared/config/AppConfig';

export interface SelectionResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ClipboardChange {
  changed: boolean;
  text?: string;
  preview?: string;
}

export function isWaylandSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY !== undefined;
}

/** djb2-style stable hash for clipboard change detection (no content stored). */
export function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export interface DesktopContextDeps {
  getConfig?: () => AppConfig;
  /** Electron 44 shape: reads are async; the X11 primary lives under `selection`. */
  clipboard?: {
    readText(): string | Promise<string>;
    selection?: {
      readText(): string | Promise<string>;
    };
  };
}

export class DesktopContextService {
  private lastClipboardHash: string | null = null;
  private readonly deps: DesktopContextDeps;

  constructor(deps: DesktopContextDeps = {}) {
    this.deps = deps;
  }

  /**
   * Selection reads use the X11 PRIMARY selection buffer — a passive
   * read, never a simulated copy keystroke (which would type into
   * whatever window has focus). Wayland exposes no readable primary to
   * Electron, and Windows/macOS have no selection buffer without
   * accessibility-API automation (recorded non-goal).
   */
  selectionSupported(): boolean {
    return process.platform === 'linux' && !isWaylandSession();
  }

  /**
   * Poll-on-summon only: compares the current clipboard against the last
   * summon's baseline. The first query after boot establishes the
   * baseline without flagging a change.
   */
  async clipboardChanged(): Promise<ClipboardChange> {
    const enabled = this.deps.getConfig?.().behavior?.clipboardWatcher === true;
    const clipboardApi = this.deps.clipboard ?? (await this.loadClipboard());
    if (!enabled || !clipboardApi) {
      return { changed: false };
    }
    const text = (await clipboardApi.readText()).trim();
    if (!text) {
      return { changed: false };
    }
    const hash = hashText(text);
    if (this.lastClipboardHash === null || hash === this.lastClipboardHash) {
      this.lastClipboardHash = hash;
      return { changed: false };
    }
    this.lastClipboardHash = hash;
    return { changed: true, text, preview: text.slice(0, 48) };
  }

  /** Reads the user's current X11 selection (only on an explicit click). */
  async captureSelection(): Promise<SelectionResult> {
    if (!this.selectionSupported()) {
      return {
        ok: false,
        error: 'Selection capture is not supported on this system (needs the X11 primary selection).',
      };
    }
    const clipboardApi = this.deps.clipboard ?? (await this.loadClipboard());
    const selection = clipboardApi?.selection;
    if (!selection) {
      return { ok: false, error: 'Selection capture is not available in this Electron build.' };
    }
    const raw = await selection.readText();
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      return { ok: false, error: 'No selection was captured.' };
    }
    return { ok: true, text };
  }

  private async loadClipboard(): Promise<DesktopContextDeps['clipboard'] | undefined> {
    try {
      const { clipboard } = await import('electron');
      return clipboard as unknown as DesktopContextDeps['clipboard'];
    } catch {
      return undefined;
    }
  }
}
