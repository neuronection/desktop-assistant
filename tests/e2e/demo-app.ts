import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import { join } from 'node:path';

export const REPO = join(__dirname, '..', '..');

async function launchOnce(
  extraArgs: string[],
  fresh: boolean,
  extraEnv: Record<string, string> = {}
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['.', '--demo', ...(fresh ? ['--demo-fresh'] : []), ...extraArgs],
    cwd: REPO,
    env: { ...process.env, NODE_ENV: 'development', DESKTOP_ASSISTANT_OPAQUE: '1', ...extraEnv },
  });
  const window = await app.firstWindow();
  return { app, window };
}

/**
 * Boots a fresh demo instance. One bounded retry: with several spec files
 * launching Electron back-to-back, a relaunch can race the previous
 * process's single-instance lock and come up as a blank window (the
 * renderer never mounts). A real boot regression still fails on the second
 * attempt — the retry only absorbs that race.
 */
export async function launchDemoApp(
  extraArgs: string[] = [],
  options: { fresh?: boolean; env?: Record<string, string> } = {}
): Promise<{ app: ElectronApplication; window: Page }> {
  const fresh = options.fresh !== false;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const launched = await launchOnce(extraArgs, fresh, options.env);
    try {
      await launched.window.waitForSelector('#app', { state: 'visible', timeout: 20_000 });
      return launched;
    } catch (error) {
      lastError = error;
      await launched.app.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('demo app failed to boot');
}
