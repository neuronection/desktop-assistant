import { test, expect } from 'playwright/test';
import { launchDemoApp } from './demo-app';

interface ResizeEvent {
  t: number;
  h: number;
}

test.describe('launcher resize while a reply streams', () => {
  test('grows in measured steps instead of a per-frame native resize burst', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    await app.evaluate(({ BrowserWindow }) => {
      const state = globalThis as typeof globalThis & { __resizeEvents?: ResizeEvent[] };
      const target = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
      state.__resizeEvents = [];
      target?.on('resize', () => {
        const bounds = target.getBounds();
        state.__resizeEvents?.push({ t: Date.now(), h: bounds.height });
      });
    });

    await window.waitForTimeout(400);
    await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { __resizeEvents?: ResizeEvent[] };
      state.__resizeEvents = [];
    });

    await window.getByRole('textbox').fill('How do I take a screenshot?');
    await window.keyboard.press('Enter');
    await window.getByText('Share screen button').waitFor({ timeout: 60_000 });
    await window.waitForTimeout(500);

    const events = await app.evaluate(() => {
      const state = globalThis as typeof globalThis & { __resizeEvents?: ResizeEvent[] };
      return state.__resizeEvents ?? [];
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.length, 'a streaming reply must not resize the native window per frame').toBeLessThanOrEqual(8);
    let burst = 1;
    for (let index = 1; index < events.length; index += 1) {
      burst = events[index].t - events[index - 1].t < 40 ? burst + 1 : 1;
      expect(burst, `native resize burst at ${events.map((event) => `${event.h}@${event.t}`).join(' ')}`).toBeLessThanOrEqual(2);
    }

    let sawShrink = false;
    for (let index = 1; index < events.length; index += 1) {
      if (events[index].h < events[index - 1].h) {
        sawShrink = true;
      } else if (sawShrink && events[index].h > events[index - 1].h) {
        throw new Error(`launcher resize oscillated: ${events.map((event) => event.h).join(' -> ')}`);
      }
    }

    await app.close();
  });
});
