import { app, BrowserWindow } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadProviderCatalog } from '@main/services/cloud/ProviderCatalog';

const BRIDGE_PROBE =
  "typeof window.electronAPI === 'object' && window.electronAPI !== null && typeof window.electronAPI.onTurnEvent === 'function'";

const LOAD_TIMEOUT_MS = 20000;

/**
 * Every renderer entry `vite.config.ts` builds. The packaged smoke asserts
 * each one exists in the frozen bundle and loads — a page that silently
 * failed to ship used to be one swallowed console line (the HUD, the popover
 * and the capture viewer are all separate entries).
 */
export const RENDERER_ENTRIES = [
  'index.html',
  'settings.html',
  'result-viewer.html',
  'pack-window.html',
  'speech-overlay.html',
  'live-host.html',
  'hub-popover.html',
  'transport-popover.html',
] as const;

function rendererRoot(): string {
  return join(app.getAppPath(), 'dist', 'renderer');
}

function waitForLoad(window: BrowserWindow, timeoutMs: number): Promise<void> {
  if (!window.webContents.isLoading()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    window.webContents.once('did-finish-load', finish);
    window.webContents.once('did-fail-load', finish);
  });
}

export async function verifyRendererBridge(timeoutMs = LOAD_TIMEOUT_MS): Promise<string> {
  const windows = BrowserWindow.getAllWindows();
  const launcher =
    windows.find((candidate) => candidate.webContents.getURL().includes('index.html')) ?? windows[0];
  if (!launcher) {
    return 'no launcher window';
  }
  await waitForLoad(launcher, timeoutMs);
  const exposed = await launcher.webContents.executeJavaScript(BRIDGE_PROBE);
  return exposed === true ? 'ok' : 'window.electronAPI is missing — the preload did not load';
}

/** The frozen bundle carries every entry the build produces. */
export function verifyRendererFiles(): string {
  const root = rendererRoot();
  const missing = RENDERER_ENTRIES.filter((entry) => !existsSync(join(root, entry)));
  return missing.length === 0 ? 'ok' : `missing renderer entries: ${missing.join(', ')}`;
}

/**
 * Each entry loads from the bundle (a missing file surfaces as
 * `did-fail-load`, not as a blank window). One hidden window is reused; a
 * page that throws after load still counts as loaded — the check is about
 * the package, not about app state.
 */
export async function verifyRendererPages(timeoutMs = LOAD_TIMEOUT_MS): Promise<string> {
  const root = rendererRoot();
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    for (const entry of RENDERER_ENTRIES) {
      const failure = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          cleanup();
          resolve(`${entry} did not finish loading within ${timeoutMs} ms`);
        }, timeoutMs);
        const onFail = (_event: unknown, errorCode: number, errorDescription: string): void => {
          cleanup();
          resolve(`${entry} failed to load (${errorCode}: ${errorDescription})`);
        };
        const onFinish = (): void => {
          cleanup();
          resolve(null);
        };
        function cleanup(): void {
          clearTimeout(timer);
          probe.webContents.removeListener('did-fail-load', onFail);
          probe.webContents.removeListener('did-finish-load', onFinish);
        }
        probe.webContents.once('did-fail-load', onFail);
        probe.webContents.once('did-finish-load', onFinish);
        void probe.loadFile(join(root, entry)).catch((error: Error) => {
          cleanup();
          resolve(`${entry} failed to load: ${error.message}`);
        });
      });
      if (failure) {
        return failure;
      }
    }
    return 'ok';
  } finally {
    if (!probe.isDestroyed()) {
      probe.destroy();
    }
  }
}

/**
 * The packaged build ships the vendored provider catalog as an extra
 * resource. Loading it here proves the file is present and parseable in the
 * frozen bundle — the dev tree always has it.
 */
export function verifyProviderCatalog(): string {
  try {
    const catalog = loadProviderCatalog();
    const calendar = catalog.providers.filter((row) => row.serviceConfig.calendar);
    if (calendar.length === 0) {
      return 'catalog has no calendar providers';
    }
    return 'ok';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Piped stdout is written asynchronously; `app.exit()` right after a
 * `console.log` can discard the line (the CI gate greps for it). Resolve
 * only once the stream reports the write, then exit.
 */
export function reportSmoke(line: string, stream: NodeJS.WriteStream = process.stdout): Promise<void> {
  return new Promise((resolve) => {
    stream.write(`${line}\n`, () => resolve());
  });
}
