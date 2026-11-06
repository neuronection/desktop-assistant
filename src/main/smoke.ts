import { BrowserWindow } from 'electron';
import { loadProviderCatalog } from '@main/services/cloud/ProviderCatalog';

const BRIDGE_PROBE =
  "typeof window.electronAPI === 'object' && window.electronAPI !== null && typeof window.electronAPI.onTurnEvent === 'function'";

const LOAD_TIMEOUT_MS = 20000;

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
