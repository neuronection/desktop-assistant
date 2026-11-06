import { test, expect } from 'playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TEXT } from '../../src/shared/constants/text';
import { launchDemoApp } from './demo-app';
import type { ElectronApplication, Page } from 'playwright';

/** Plan 62: the HUD and a visible chat surface never share the screen. */
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

async function showLauncher(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const candidate = BrowserWindow.getAllWindows().find(
      (win) =>
        !win.webContents.getURL().includes('speech-overlay.html') &&
        !win.webContents.getURL().includes('transport-popover.html')
    );
    candidate?.show();
    candidate?.focus();
  });
}

async function overlayVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => {
    const candidate = BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('speech-overlay.html')
    );
    return candidate ? candidate.isVisible() : false;
  });
}

const speechUrl = (page: Page): boolean => page.url().includes('speech-overlay.html');

async function waitForPage(app: ElectronApplication, needle: string): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes(needle))).toBe(true);
  return app.windows().find((page) => page.url().includes(needle))!;
}

function snapshot(window: Page) {
  return window.evaluate(async () => window.electronAPI.getSpeechSnapshot());
}

test.describe('speech bus end-to-end (plan 58 S7)', () => {
  test('speak → HUD → pause/resume → stop → cache written', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp();
    await hideChatWindows(app);

    const outcome = await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Bus end to end check.', source: 'clipboard' })
    );
    expect(outcome).toBe('started');

    const overlay = await waitForPage(app, 'speech-overlay.html');
    await overlay.waitForLoadState('domcontentloaded');
    expect(speechUrl(overlay)).toBe(true);
    await overlay.getByText('Bus end to end check.').waitFor({ timeout: 30_000 });
    await expect(overlay.getByRole('status')).toContainText('1 of 1', { timeout: 20_000 });

    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'speaking',
      undefined,
      { timeout: 30_000 }
    );

    await window.evaluate(() => window.electronAPI.controlSpeech('pause'));
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'paused',
      undefined,
      { timeout: 10_000 }
    );
    const cardActions = overlay.locator('.sh-card .sh-actions');
    await expect(cardActions.getByRole('button', { name: TEXT.SPEECH_RESUME })).toBeVisible();

    const body = overlay.getByTestId('speech-hud-body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    await overlay.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'speaking',
      undefined,
      { timeout: 10_000 }
    );

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'idle',
      undefined,
      { timeout: 10_000 }
    );

    const dataDir = (await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))) as string;
    const cached = readdirSync(join(dataDir, 'speech-cache')).filter((name) => name.endsWith('.wav'));
    expect(cached.length).toBeGreaterThan(0);

    await app.close();
  });

  test('the HUD card stays window-bound — long text ellipsizes, the progress label stays visible', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp();
    await hideChatWindows(app);
    const longLine =
      'Then in Settings → Voice: assign the TTS task to your speech model and press the chord to hear it.';
    await window.evaluate(
      (text) => window.electronAPI.speakText({ text, source: 'clipboard' }),
      longLine
    );
    const overlay = await app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await overlay.waitForLoadState('domcontentloaded');
    await overlay.getByRole('status').waitFor({ timeout: 30_000 });

    const layout = await overlay.evaluate(() => {
      const card = document.querySelector('.sh-card')!.getBoundingClientRect();
      const stage = document.querySelector('.hud-stage')!.getBoundingClientRect();
      const progress = document.querySelector('.sh-progress')!.getBoundingClientRect();
      const text = document.querySelector('.sh-text') as HTMLElement;
      const style = getComputedStyle(text);
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.body.scrollWidth,
        cardWidth: card.width,
        cardLeft: card.left,
        cardRight: card.right,
        stageWidth: stage.width,
        progressRight: progress.right,
        textClientWidth: text.clientWidth,
        textScrollWidth: text.scrollWidth,
        textOverflow: style.textOverflow,
      };
    });

    expect(layout.scrollWidth, 'no horizontal overflow inside the HUD window').toBeLessThanOrEqual(
      layout.innerWidth
    );
    expect(layout.stageWidth).toBe(layout.innerWidth);
    expect(layout.cardWidth).toBeGreaterThan(389);
    expect(layout.cardWidth).toBeLessThanOrEqual(400);
    expect(layout.cardLeft).toBeGreaterThanOrEqual(9);
    expect(layout.cardRight).toBeLessThanOrEqual(layout.innerWidth - 9);
    expect(layout.progressRight).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.textOverflow).toBe('ellipsis');
    expect(layout.textScrollWidth).toBeGreaterThan(layout.textClientWidth);

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await app.close();
  });

  test('every HUD style opens at its size and its controls drive the bus', async () => {
    test.setTimeout(240_000);
    const cases = [
      { style: 'dot', width: 132, height: 48 },
      { style: 'edge', width: 240, height: 97 },
    ] as const;

    for (const entry of cases) {
      const { app, window } = await launchDemoApp();
      await window.evaluate(async (style) => {
        const config = await window.electronAPI.loadConfig();
        await window.electronAPI.saveConfig({ ...config, voice: { ...config.voice, speechHudStyle: style } });
      }, entry.style);

      await window.evaluate(
        (line) => window.electronAPI.speakText({ text: line, source: 'clipboard' }),
        `${entry.style} style check.`
      );
      const overlay = await waitForPage(app, 'speech-overlay.html');
      await overlay.waitForLoadState('domcontentloaded');
      await hideChatWindows(app);
      await window.waitForFunction(
        async () => (await window.electronAPI.getSpeechSnapshot()).state !== 'idle',
        undefined,
        { timeout: 20_000 }
      );

      const bounds = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('speech-overlay.html')
        );
        return win ? win.getBounds() : null;
      });
      expect(bounds, entry.style).toMatchObject({ width: entry.width, height: entry.height });

      const overlaps = await overlay.evaluate(() => {
        const hit = (a: DOMRect, b: DOMRect): boolean =>
          a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
        const buttons = [...document.querySelectorAll('.hud-ghost')].map((el) => ({
          el,
          rect: el.getBoundingClientRect(),
        }));
        const visuals = [
          ...document.querySelectorAll('.hud-wave, .hud-tab-bars, .sh-knob-fill, .sh-track'),
        ].map((el) => ({ el, rect: el.getBoundingClientRect() }));
        const found: string[] = [];
        for (const visual of visuals) {
          for (const button of buttons) {
            if (hit(visual.rect, button.rect)) {
              found.push(`${visual.el.className} × ${button.el.getAttribute('aria-label')}`);
            }
          }
        }
        return found;
      });
      expect(overlaps, `${entry.style}: controls overlap a visualization`).toEqual([]);
      if (entry.style === 'edge') {
        const workArea = await app.evaluate(({ screen }) =>
          screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
        );
        expect(bounds!.x + bounds!.width).toBe(workArea.x + workArea.width);
      }
      if (entry.style === 'dot') {
        const workArea = await app.evaluate(({ screen }) =>
          screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
        );
        expect(bounds!.x).toBeGreaterThanOrEqual(workArea.x + 12);
        expect(bounds!.y).toBeGreaterThanOrEqual(workArea.y + 12);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(workArea.x + workArea.width - 12);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(workArea.y + workArea.height - 12);
      }

      if (entry.style === 'dot') {
        await overlay.getByRole('button', { name: TEXT.SPEECH_STOP }).click();
      } else {
        const actions = overlay.locator('.sh-knob-actions');
        await actions.getByRole('button', { name: TEXT.SPEECH_PAUSE }).click();
      }
      await window.waitForFunction(
        async (style) =>
          (await window.electronAPI.getSpeechSnapshot()).state === (style === 'dot' ? 'idle' : 'paused'),
        entry.style,
        { timeout: 20_000 }
      );

      await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
      await app.close();
    }
  });

  test('the card hands control back to the launcher', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp();
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

    await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Hand me back.', source: 'clipboard' })
    );
    const overlay = await app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await overlay.waitForLoadState('domcontentloaded');
    const open = overlay.getByRole('button', { name: TEXT.SPEECH_HUD_OPEN_ASSISTANT });
    await open.waitFor({ timeout: 30_000 });
    await open.click();

    await expect
      .poll(
        async () =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some(
              (candidate) =>
                !candidate.webContents.getURL().includes('speech-overlay.html') &&
                !candidate.webContents.getURL().includes('transport-popover.html') &&
                candidate.isVisible()
            )
          ),
        { timeout: 15_000 }
      )
      .toBe(true);

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await app.close();
  });

  test('the launcher and the HUD never share the screen', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp();
    await window.evaluate(async () => {
      const config = await window.electronAPI.loadConfig();
      await window.electronAPI.saveConfig({
        ...config,
        voice: { ...config.voice, speechHudPosture: 'pinned' },
      });
    });
    await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Visibility boundary check.', source: 'clipboard' })
    );
    const overlay = await app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await overlay.waitForLoadState('domcontentloaded');

    await expect.poll(() => overlayVisible(app), { timeout: 15_000 }).toBe(false);
    await hideChatWindows(app);
    await expect.poll(() => overlayVisible(app), { timeout: 15_000 }).toBe(true);

    await showLauncher(app);
    await expect.poll(() => overlayVisible(app), { timeout: 15_000 }).toBe(false);
    await hideChatWindows(app);
    await expect.poll(() => overlayVisible(app), { timeout: 15_000 }).toBe(true);

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await app.close();
  });

  test('a killed overlay is recreated and resumes the utterance', async () => {
    test.setTimeout(180_000);
    const { app, window } = await launchDemoApp();
    await hideChatWindows(app);
    await window.evaluate(() =>
      window.electronAPI.speakText({ text: 'Crash recovery check.', source: 'clipboard' })
    );
    const overlay = await app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await overlay.waitForLoadState('domcontentloaded');
    await window.waitForFunction(
      async () => (await window.electronAPI.getSpeechSnapshot()).state === 'speaking',
      undefined,
      { timeout: 30_000 }
    );

    const recreated = app.waitForEvent('window', { predicate: (page) => page.url().includes('speech-overlay.html') });
    await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('speech-overlay.html')
      );
      target?.webContents.forcefullyCrashRenderer();
    });
    const next = await recreated;
    await next.waitForLoadState('domcontentloaded');
    expect(speechUrl(next)).toBe(true);
    await next.getByText('Crash recovery check.').waitFor({ timeout: 30_000 });

    const state = await snapshot(window);
    expect(['speaking', 'synthesizing', 'idle']).toContain(state.state);

    await window.evaluate(() => window.electronAPI.controlSpeech('stop'));
    await app.close();
  });
});
