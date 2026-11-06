import { test, expect } from 'playwright/test';
import { TEXT } from '../../src/shared/constants/text';
import { launchDemoApp } from './demo-app';
import type { ElectronApplication } from 'playwright';

async function showChatWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const candidate = BrowserWindow.getAllWindows().find(
      (win) =>
        !win.webContents.getURL().includes('speech-overlay.html') &&
        !win.webContents.getURL().includes('live-host.html') &&
        !win.webContents.getURL().includes('transport-popover.html')
    );
    candidate?.show();
    candidate?.focus();
  });
}

async function overlayVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('speech-overlay.html')
    );
    return overlay ? overlay.isVisible() : false;
  });
}

async function chatVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (win) =>
        !win.webContents.getURL().includes('speech-overlay.html') &&
        !win.webContents.getURL().includes('live-host.html') &&
        !win.webContents.getURL().includes('transport-popover.html') &&
        win.isVisible() &&
        !win.isMinimized()
    )
  );
}

async function hostState(app: ElectronApplication): Promise<{ present: boolean; visible: boolean }> {
  return app.evaluate(({ BrowserWindow }) => {
    const host = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('live-host.html')
    );
    return { present: !!host, visible: host ? host.isVisible() : false };
  });
}

test.describe('hidden live host (plan 61)', () => {
  test('starting live from the tray/hotkey path stays in the HUD', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp(['--use-fake-device-for-media-stream']);
    await window.waitForSelector('#app', { state: 'visible', timeout: 30_000 });
    const state = async (): Promise<string> =>
      window.evaluate(async () => (await window.electronAPI.getLiveState()).state);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((candidate) => {
        if (!candidate.webContents.getURL().includes('speech-overlay.html') &&
            !candidate.webContents.getURL().includes('live-host.html')) {
          candidate.hide();
        }
      });
    });
    await app.evaluate(({ BrowserWindow }) => {
      const launcher = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.getURL().includes('speech-overlay.html') &&
          !candidate.webContents.getURL().includes('live-host.html') &&
          !candidate.webContents.getURL().includes('transport-popover.html')
      );
      launcher?.webContents.send('hotkey:start-live');
    });
    await expect.poll(async () => state(), { timeout: 30_000 }).toBe('listening');
    await expect.poll(() => chatVisible(app), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => overlayVisible(app), { timeout: 10_000 }).toBe(true);
    expect(await state()).toBe('listening');

    await window.evaluate(() => window.electronAPI.stopLive());
    await app.close();
  });

  test('a mic failure surfaces the launcher and keeps the HUD hidden', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp(['--use-fake-device-for-media-stream'], {
      env: { DESKTOP_ASSISTANT_LIVE_HOST_FAIL: 'mic_denied' },
    });
    await window.waitForSelector('#app', { state: 'visible', timeout: 30_000 });
    const state = async (): Promise<string> =>
      window.evaluate(async () => (await window.electronAPI.getLiveState()).state);

    // Start from the hidden tray path, then prove the failure brings the
    // launcher back with the error instead of leaving a silent HUD.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((candidate) => {
        if (!candidate.webContents.getURL().includes('speech-overlay.html') &&
            !candidate.webContents.getURL().includes('live-host.html')) {
          candidate.hide();
        }
      });
    });
    await expect.poll(() => chatVisible(app), { timeout: 10_000 }).toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      const launcher = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.getURL().includes('speech-overlay.html') &&
          !candidate.webContents.getURL().includes('live-host.html') &&
          !candidate.webContents.getURL().includes('transport-popover.html')
      );
      launcher?.webContents.send('hotkey:start-live');
    });
    await expect.poll(async () => state(), { timeout: 30_000 }).toBe('error');
    await expect.poll(() => chatVisible(app), { timeout: 10_000 }).toBe(true);
    expect(await overlayVisible(app)).toBe(false);
    await app.close();
  });

  test('live runs in a hidden host and survives the launcher disappearing', async () => {
    test.setTimeout(240_000);
    const { app, window } = await launchDemoApp(['--use-fake-device-for-media-stream']);
    await window.waitForSelector('#app', { state: 'visible', timeout: 30_000 });

    const state = async (): Promise<string> =>
      window.evaluate(async () => (await window.electronAPI.getLiveState()).state);
    const startLive = async (): Promise<void> => {
      await showChatWindow(app);
      await window.getByRole('button', { name: TEXT.LIVE_START }).first().click();
    };

    await startLive();
    await expect.poll(async () => state(), { timeout: 30_000 }).toBe('listening');
    expect(await state()).toBe('listening');
    expect(await hostState(app)).toMatchObject({ present: true, visible: false });
    // Plan 62 S4: the launcher handed the surface to the HUD.
    await expect.poll(() => chatVisible(app), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => overlayVisible(app), { timeout: 10_000 }).toBe(true);
    expect(await state()).toBe('listening');
    const overlay = app.windows().find((page) => page.url().includes('speech-overlay.html'));
    await overlay?.waitForLoadState('domcontentloaded');
    await expect(overlay!.getByRole('status')).toContainText(TEXT.LIVE_HUD_LISTENING);

    // Reopening the launcher hides the HUD but never stops live.
    await showChatWindow(app);
    await expect.poll(() => chatVisible(app), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => overlayVisible(app), { timeout: 10_000 }).toBe(false);
    expect(await state()).toBe('listening');

    await window.evaluate(() => window.electronAPI.stopLive());
    await expect.poll(async () => state(), { timeout: 15_000 }).toBe('idle');

    // A stopped session can start again on the same warm host.
    await startLive();
    await expect.poll(async () => state(), { timeout: 30_000 }).toBe('listening');

    // A dead host ends the session instead of resurrecting audio, and the
    // next start recreates it.
    await app.evaluate(({ BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows().find((win) =>
        win.webContents.getURL().includes('live-host.html')
      );
      host?.webContents.forcefullyCrashRenderer();
    });
    await expect.poll(async () => state(), { timeout: 15_000 }).toBe('idle');
    expect(await hostState(app)).toMatchObject({ present: false });

    await startLive();
    await expect.poll(async () => state(), { timeout: 30_000 }).toBe('listening');
    expect(await hostState(app)).toMatchObject({ present: true, visible: false });

    await window.evaluate(() => window.electronAPI.stopLive());
    await app.close();
  });
});
