import { execFile } from 'node:child_process';
import type { AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';

export type SelectionFailure = 'unsupported' | 'no_selection';

export interface SelectionResult {
  ok: boolean;
  text?: string;
  error?: string;
  /** Typed failure for the speech bus (§4.5: never tell a Wayland user "nothing was selected"). */
  reason?: SelectionFailure;
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

export type DesktopExec = (
  file: string,
  args: string[],
  options: { timeout: number }
) => Promise<string>;

const defaultExec: DesktopExec = (file, args, options) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      }
    );
  });

export interface DesktopContextDeps {
  getConfig?: () => AppConfig;
  /** Electron 44 shape: reads are async; the X11 primary lives under `selection`. */
  clipboard?: {
    readText(): string | Promise<string>;
    selection?: {
      readText(): string | Promise<string>;
    };
  };
  /** Injected for tests; defaults to the real process. */
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exec?: DesktopExec;
}

const WL_PASTE_TIMEOUT_MS = 300;

export class DesktopContextService {
  private lastClipboardHash: string | null = null;
  private wlPasteSupport: Promise<boolean> | null = null;
  private readonly deps: DesktopContextDeps;

  constructor(deps: DesktopContextDeps = {}) {
    this.deps = deps;
  }

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  private env(): NodeJS.ProcessEnv {
    return this.deps.env ?? process.env;
  }

  /**
   * Shared gate for the insert feature AND speech (plan 58 §4.5). X11 is
   * native; Wayland is best-effort — only when `wl-paste` exists, because
   * Electron exposes no readable primary there.
   */
  async selectionSupported(): Promise<boolean> {
    if (this.platform() !== 'linux') {
      return false;
    }
    if (!isWaylandSession(this.env())) {
      return true;
    }
    return this.hasWlPaste();
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

  async readClipboard(): Promise<string> {
    const clipboardApi = this.deps.clipboard ?? (await this.loadClipboard());
    if (!clipboardApi) {
      return '';
    }
    const text = await clipboardApi.readText();
    return typeof text === 'string' ? text.trim() : '';
  }

  /**
   * Selection reads use the X11 PRIMARY selection buffer — a passive
   * read, never a simulated copy keystroke (which would type into
   * whatever window has focus). Wayland has no readable primary via
   * Electron, so a constrained `wl-paste` argv-array read is the only
   * fallback; Windows/macOS stay unsupported (recorded non-goal).
   */
  async readPrimarySelection(): Promise<SelectionResult> {
    const native = await this.readElectronPrimary();
    if (native) {
      return native;
    }
    const wayland = await this.readWlPasteSelection();
    if (wayland) {
      return wayland;
    }
    if (!(await this.selectionSupported())) {
      return { ok: false, reason: 'unsupported', error: TEXT.SELECTION_UNSUPPORTED };
    }
    return { ok: false, reason: 'no_selection', error: TEXT.SELECTION_EMPTY };
  }

  private async readElectronPrimary(): Promise<SelectionResult | null> {
    const clipboardApi = this.deps.clipboard ?? (await this.loadClipboard());
    const selection = clipboardApi?.selection;
    if (!selection) {
      return null;
    }
    try {
      const raw = await selection.readText();
      const text = typeof raw === 'string' ? raw.trim() : '';
      return text ? { ok: true, text } : null;
    } catch {
      return null;
    }
  }

  private async readWlPasteSelection(): Promise<SelectionResult | null> {
    if (this.platform() !== 'linux' || !(await this.hasWlPaste())) {
      return null;
    }
    try {
      const raw = await this.execWl(['--primary', '--no-newline']);
      const text = raw.trim();
      return text ? { ok: true, text } : null;
    } catch {
      return null;
    }
  }

  private hasWlPaste(): Promise<boolean> {
    if (!this.wlPasteSupport) {
      this.wlPasteSupport = this.execWl(['--version']).then(
        () => true,
        (error: { code?: string } | null) => error?.code !== 'ENOENT'
      );
    }
    return this.wlPasteSupport;
  }

  private execWl(args: string[]): Promise<string> {
    const exec = this.deps.exec ?? defaultExec;
    return exec('wl-paste', args, { timeout: WL_PASTE_TIMEOUT_MS });
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
