import { test, expect } from 'playwright/test';
import { TEXT } from '../../src/shared/constants/text';
import { launchDemoApp } from './demo-app';
import type { ElectronApplication, Page } from 'playwright';

async function hideChatWindows(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((candidate) => {
      if (
        !candidate.webContents.getURL().includes('speech-overlay.html') &&
        !candidate.webContents.getURL().includes('transport-popover.html')
      ) {
        candidate.hide();
      }
    });
  });
}

async function waitForPage(app: ElectronApplication, needle: string): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes(needle))).toBe(true);
  return app.windows().find((page) => page.url().includes(needle))!;
}

async function windowVisible(app: ElectronApplication, needle: string): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, match) => {
    const candidate = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes(match));
    return candidate ? candidate.isVisible() : false;
  }, needle);
}

test.describe('hub dock end-to-end (plan 65/66)', () => {
  test('top-edge text dock uses three lines inside a centered envelope', async () => {
    test.setTimeout(180_000);
    const vitePort = process.env.VITE_PORT ?? '3300';
    const { app, window } = await launchDemoApp([], { env: { VITE_PORT: vitePort } });
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: {
          ...config.voice,
          speechHudStyle: 'edge',
          speechHudEdgeSide: 'top',
          speechHudPosture: 'pinned',
          hubDockText: 'latest',
          hubDockWidth: 160,
          hubTabActions: ['translate-selection', 'speak-selection'],
          hubLiveOnTab: true,
        },
      });
    });
    await hideChatWindows(app);
    const overlayPromise = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await window.evaluate(() =>
      window.electronAPI.speakText({
        text: 'Top edge one-line dock check with a long line that truncates cleanly.',
        source: 'clipboard',
      })
    );
    const overlay = await overlayPromise;
    await overlay.waitForLoadState('domcontentloaded');
    await hideChatWindows(app);
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state !== 'idle',
      undefined,
      { timeout: 30_000 }
    );
    await overlay.waitForTimeout(500);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('speech-overlay.html')
        );
        win?.webContents.send('hub:result', {
          id: 'translate-selection',
          kind: 'translation',
          title: 'Translation · en → el',
          text: 'Το HUD μπορεί να πατηθεί τώρα και να δείξει μια μεγαλύτερη γραμμή μετάφρασης.',
          retryable: true,
        });
      });
      await overlay.waitForTimeout(200);
    }
    await expect(overlay.locator('.sh-knob')).toHaveAttribute('data-content', 'multi');
    const layout = await overlay.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
      const text = document.querySelector('.sh-knob-text') as HTMLElement;
      return {
        window: { width: innerWidth, height: innerHeight },
        stage: rect('.hud-stage'),
        knob: rect('.sh-knob'),
        text: rect('.sh-knob-text'),
        actions: rect('.sh-knob-actions'),
        textContent: text.textContent ?? '',
        lineHeight: parseFloat(getComputedStyle(text).lineHeight),
        clamp: getComputedStyle(text).webkitLineClamp,
        bars: getComputedStyle(document.querySelector('.hud-tab-bars')).display,
      };
    });
    expect(layout.window).toEqual({ width: 240, height: 97 });
    expect(layout.stage).toMatchObject({ width: 240, height: 97 });
    expect(layout.knob).toMatchObject({ width: 220, height: 77 });
    expect(layout.textContent.length).toBeGreaterThan(0);
    expect(layout.clamp).toBe('3');
    expect(layout.bars).toBe('none');
    expect(layout.text.left).toBeLessThan(30);
    expect(layout.text.height).toBeLessThanOrEqual(layout.lineHeight * 3 + 2);
    expect(layout.text.top).toBeGreaterThanOrEqual(layout.knob.top);
    expect(layout.text.bottom).toBeLessThanOrEqual(layout.knob.bottom);
    expect(layout.actions.bottom).toBeLessThanOrEqual(layout.knob.bottom);

    const beforeDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    await overlay.evaluate(() => {
      const body = document.querySelector('[data-testid="speech-hud-body"]');
      const opts = { bubbles: true, button: 0, pointerId: 1, screenX: 900, screenY: 10 };
      body?.dispatchEvent(new PointerEvent('pointerdown', opts));
      body?.dispatchEvent(new PointerEvent('pointermove', { ...opts, screenX: 1150 }));
      body?.dispatchEvent(new PointerEvent('pointerup', { ...opts, screenX: 1150 }));
    });
    await overlay.waitForTimeout(400);
    const afterDrag = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    expect(afterDrag).toMatchObject({ width: beforeDrag?.width, height: beforeDrag?.height });
    expect(afterDrag?.x).not.toBe(beforeDrag?.x);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      win?.webContents.send('hub:busy', { id: 'translate-selection', active: true });
    });
    await expect(overlay.locator('.sh-knob')).toHaveAttribute('data-hub-busy', 'true');
    await expect(overlay.locator('.sh-knob-text')).toContainText(TEXT.HUB_BUSY_TRANSLATING);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      win?.webContents.send('hub:busy', { id: 'translate-selection', active: false });
      win?.webContents.send('live:event', {
        type: 'state',
        snapshot: {
          state: 'listening',
          capture: 'open',
          downgraded: false,
          turns: 0,
          candidate: false,
          session: 1,
        },
      });
    });
    await expect(overlay.locator('.sh-knob-text')).toContainText(TEXT.LIVE_HUD_LISTENING);
    await expect(overlay.locator(`.hud-playback[aria-label="${TEXT.HUB_LIVE_END}"]`)).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      win?.webContents.send('live:mic-level', 0.85);
    });
    await expect
      .poll(() => overlay.evaluate(() => getComputedStyle(document.querySelector('.hud-stage')!).getPropertyValue('--hud-mic-level').trim()))
      .toBe('0.85');
    await app.close();
  });

  test('cross-edge drag previews and persists another edge', async () => {
    test.setTimeout(180_000);
    const vitePort = process.env.VITE_PORT ?? '3300';
    const { app, window } = await launchDemoApp([], { env: { VITE_PORT: vitePort } });
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: {
          ...config.voice,
          speechHudStyle: 'edge',
          speechHudEdgeSide: 'top',
          speechHudPosture: 'pinned',
          hubDockText: 'latest',
          hubDockWidth: 'auto',
        },
      });
    });
    await hideChatWindows(app);
    const overlayPromise = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Cross edge drag check.', source: 'clipboard' })
    );
    const overlay = await overlayPromise;
    await overlay.waitForLoadState('domcontentloaded');
    await hideChatWindows(app);
    await overlay.locator('.sh-knob-text').waitFor({ timeout: 20_000 });
    await overlay.waitForTimeout(800);
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const before = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    const startX = (before?.x ?? 0) + Math.round((before?.width ?? 240) / 2);
    const startY = (before?.y ?? 0) + 10;
    const targetX = area.x + area.width - 16;
    const targetY = area.y + Math.round(area.height / 2);

    await overlay.evaluate(
      ({ startX, startY, targetX, targetY }) => {
        const body = document.querySelector('[data-testid="speech-hud-body"]');
        const opts = { bubbles: true, button: 0, pointerId: 1, screenX: startX, screenY: startY };
        body?.dispatchEvent(new PointerEvent('pointerdown', opts));
        body?.dispatchEvent(new PointerEvent('pointermove', { ...opts, screenX: targetX, screenY: targetY }));
      },
      { startX, startY, targetX, targetY }
    );
    // The first move arms the candidate; a second move after the dwell commits it.
    await overlay.waitForTimeout(260);
    await overlay.evaluate(
      ({ targetX, targetY }) => {
        const body = document.querySelector('[data-testid="speech-hud-body"]');
        const opts = { bubbles: true, button: 0, pointerId: 1, screenX: targetX, screenY: targetY };
        body?.dispatchEvent(new PointerEvent('pointermove', opts));
        body?.dispatchEvent(new PointerEvent('pointerup', opts));
      },
      { targetX, targetY }
    );
    await window.waitForFunction(
      async () => (await window.electronAPI.loadConfig()).voice.speechHudEdgeSide === 'right',
      undefined,
      { timeout: 10_000 }
    );
    const after = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    expect(after).toMatchObject({ width: 240, height: 97 });
    expect(after?.x).toBe(area.x + area.width - 240);
    await overlay.waitForTimeout(500);
    await expect(overlay.locator('.sh-knob')).toHaveAttribute('data-side', 'right');

    await overlay.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await overlay.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'idle'
    );
    await overlay.getByRole('button', { name: TEXT.HUB_ACTION_DICTATE }).click();
    await expect(overlay.locator('.sh-knob-text')).toContainText(TEXT.HUB_DICTATION_UNAVAILABLE);
    const launcherVisible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (candidate) =>
          candidate.isVisible() &&
          !candidate.webContents.getURL().includes('speech-overlay.html') &&
          !candidate.webContents.getURL().includes('transport-popover.html')
      )
    );
    expect(launcherVisible).toBe(false);
    await app.close();
  });

  test('size presets recreate the HUD once at their envelope', async () => {
    test.setTimeout(180_000);
    const vitePort = process.env.VITE_PORT ?? '3300';
    const { app, window } = await launchDemoApp([], { env: { VITE_PORT: vitePort } });
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: {
          ...config.voice,
          speechHudStyle: 'edge',
          speechHudEdgeSide: 'top',
          speechHudPosture: 'pinned',
          hubDockText: 'latest',
          hudSizePreset: 'comfort',
        },
      });
    });
    await hideChatWindows(app);
    const first = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Size preset check.', source: 'clipboard' })
    );
    const overlay = await first;
    await overlay.waitForLoadState('domcontentloaded');
    await hideChatWindows(app);
    await overlay.locator('.sh-knob').waitFor({ timeout: 20_000 });

    const next = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: { ...config.voice, hudSizePreset: 'large' },
      });
    });
    const larger = await next;
    await larger.waitForLoadState('domcontentloaded');
    await larger.locator('.sh-knob').waitFor({ timeout: 20_000 });
    const largeBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    expect(largeBounds).toMatchObject({ width: 260, height: 104 });

    const back = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: { ...config.voice, hudSizePreset: 'comfort' },
      });
    });
    const comfort = await back;
    await comfort.waitForLoadState('domcontentloaded');
    await comfort.locator('.sh-knob').waitFor({ timeout: 20_000 });
    const comfortBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win?.getBounds() ?? null;
    });
    expect(comfortBounds).toMatchObject({ width: 240, height: 97 });
    await app.close();
  });

  test('wide dock text, preset, conditional controls and the quick-actions popover', async () => {
    test.setTimeout(240_000);
    const vitePort = process.env.VITE_PORT ?? '3300';
    const { app, window } = await launchDemoApp([], { env: { VITE_PORT: vitePort } });

    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: {
          ...config.voice,
          speechHudStyle: 'edge',
          speechHudEdgeSide: 'right',
          speechHudPosture: 'pinned',
          hubDockText: 'latest',
          hubDockWidth: 'auto',
          hubTabActions: ['translate-selection', 'speak-selection'],
          hubLiveOnTab: true,
          hudPreset: 'aurora',
          hudControls: 'auto',
        },
      });
    });
    await hideChatWindows(app);

    const line =
      'This is a long dock line that stays on screen while the speech bus plays, so the wide text mode and the conditional controls have time to settle before the test checks them.';
    const overlayPromise = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    const outcome = await window.evaluate(
      (text) => window.electronAPI.speakText({ text, source: 'clipboard' }),
      line
    );
    expect(outcome).toBe('started');
    const overlay = await overlayPromise;
    await overlay.waitForLoadState('domcontentloaded');
    await hideChatWindows(app);
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state !== 'idle',
      undefined,
      { timeout: 30_000 }
    );
    await overlay.locator('.hud-stage[data-preset="aurora"]').waitFor({ timeout: 20_000 });
    await overlay.locator('.sh-knob-text').waitFor({ timeout: 20_000 });
    await expect(overlay.locator('.sh-knob-text')).not.toBeEmpty();
    await expect(overlay.locator(`.hud-playback[aria-label="${TEXT.SPEECH_PAUSE}"]`)).toBeVisible();

    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      return win ? win.getBounds() : null;
    });
    expect(bounds?.width).toBe(240);
    expect(bounds?.height).toBe(97);

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'idle',
      undefined,
      { timeout: 20_000 }
    );
    await expect(overlay.locator('.hud-playback')).toHaveCount(0);
    await expect(overlay.locator('.sh-knob')).toHaveAttribute('data-content', 'empty');
    expect(await overlay.locator('.sh-knob').evaluate((el) => el.getBoundingClientRect().height)).toBe(25);
    await expect(overlay.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE })).toBeVisible();
    const hubBefore = await overlay.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }).boundingBox();
    await overlay.locator('.sh-knob').hover();
    const hubAfter = await overlay.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }).boundingBox();
    const roundBox = (box: { x: number; y: number; width: number; height: number } | null) =>
      box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : box;
    expect(roundBox(hubAfter)).toEqual(roundBox(hubBefore));

    const hubPromise = app.waitForEvent('window');
    await overlay.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }).click();
    const hub = await hubPromise;
    await hub.waitForLoadState('domcontentloaded');
    await expect(hub.locator('.hub-title')).toHaveText(TEXT.HUB_POPOVER_TITLE);
    for (let page = 0; page < 3; page += 1) {
      if (await hub.getByRole('button', { name: new RegExp(TEXT.HUB_ACTION_ASSISTANT) }).count()) {
        break;
      }
      const next = hub.getByRole('button', { name: TEXT.HUB_PAGE_NEXT });
      if (!(await next.count())) {
        break;
      }
      await next.click();
    }
    await expect(hub.getByRole('button', { name: new RegExp(TEXT.HUB_ACTION_ASSISTANT) })).toBeVisible();

    await hub.getByRole('button', { name: TEXT.HUB_POPOVER_CLOSE }).click();
    await expect.poll(() => windowVisible(app, 'hub-popover.html')).toBe(false);

    await overlay.getByRole('button', { name: TEXT.HUB_POPOVER_TITLE }).click();
    await expect.poll(() => windowVisible(app, 'hub-popover.html')).toBe(true);
    await hub.getByRole('button', { name: new RegExp(TEXT.HUB_ACTION_ASSISTANT) }).click();
    await expect.poll(() => windowVisible(app, 'hub-popover.html')).toBe(false);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (candidate) =>
              candidate.isVisible() &&
              !candidate.webContents.getURL().includes('speech-overlay.html') &&
              !candidate.webContents.getURL().includes('transport-popover.html') &&
              !candidate.webContents.getURL().includes('hub-popover.html')
          )
        )
      )
      .toBe(true);

    await app.evaluate(({ BrowserWindow }, pageUrl) => {
      const launcher = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === pageUrl);
      launcher?.webContents.send('launcher:open-with-text', 'Hallo Welt');
    }, window.url());
    await expect(window.locator('textarea').first()).toHaveValue('Hallo Welt');

    await app.close();
  });
});
