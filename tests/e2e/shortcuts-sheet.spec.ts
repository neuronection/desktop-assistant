import { test, expect } from 'playwright/test';
import { TEXT } from '../../src/shared/constants/text';
import { launchDemoApp } from './demo-app';


test.describe('shortcuts sheet (plan 59)', () => {
  test('Ctrl+/ opens the live sheet; Escape closes it and the launcher stays', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    await window.keyboard.press('Control+/');
    const sheet = window.getByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    await sheet.waitFor({ timeout: 20_000 });
    await expect(sheet.getByRole('heading', { name: TEXT.SHORTCUTS_GROUP_GENERAL })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: TEXT.SHORTCUTS_GROUP_VOICE })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: TEXT.SHORTCUTS_GROUP_IN_WINDOW })).toBeVisible();
    await expect(sheet.getByText(TEXT.SPEECH_HOTKEY_SPEAK_SELECTION)).toBeVisible();
    await expect(sheet.getByRole('button', { name: TEXT.SHORTCUTS_CUSTOMIZE })).toBeVisible();

    const layout = await window.evaluate(
      (labels) => {
        const box = (label: string) => {
          const element = document.querySelector(`[role="group"][aria-label="${label}"]`) as HTMLElement | null;
          const rect = element?.getBoundingClientRect();
          return rect ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom } : null;
        };
        const scroll = document.querySelector('[data-testid="shortcuts-scroll"]') as HTMLElement;
        const grid = document.querySelector('[data-testid="shortcuts-grid"]') as HTMLElement;
        return {
          overflowing: scroll.scrollHeight > scroll.clientHeight + 1,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          general: box(labels.general),
          voice: box(labels.voice),
          inWindow: box(labels.inWindow),
        };
      },
      {
        general: TEXT.SHORTCUTS_GROUP_GENERAL,
        voice: TEXT.SHORTCUTS_GROUP_VOICE,
        inWindow: TEXT.SHORTCUTS_GROUP_IN_WINDOW,
      }
    );
    expect(layout.overflowing, 'a fresh install fits without the internal scrollbar').toBe(false);
    expect(layout.columns).toBe(2);
    expect(layout.general && layout.voice && layout.inWindow).toBeTruthy();
    expect(Math.abs((layout.general?.top ?? 0) - (layout.voice?.top ?? 0))).toBeLessThan(2);
    expect(layout.general!.right).toBeLessThanOrEqual(layout.voice!.left + 1);
    expect(layout.inWindow!.top).toBeGreaterThanOrEqual(Math.min(layout.general!.bottom, layout.voice!.bottom) - 1);

    await window.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);

    await app.close();
  });

  test('the launcher menu opens the sheet and Customize deep-links to Settings → Hotkeys', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    await window.getByRole('button', { name: TEXT.LAUNCHER_MORE_BUTTON }).click();
    await window.getByRole('menuitem', { name: new RegExp(TEXT.SHORTCUTS_MENU) }).click();
    const sheet = window.getByRole('dialog', { name: TEXT.SHORTCUTS_TITLE });
    await sheet.waitFor({ timeout: 20_000 });

    const settingsPromise = app.waitForEvent('window');
    await sheet.getByRole('button', { name: TEXT.SHORTCUTS_CUSTOMIZE }).click();
    const settings = await settingsPromise;
    await settings.waitForLoadState('domcontentloaded');
    await settings.getByText(TEXT.HOTKEYS_TITLE).waitFor({ timeout: 30_000 });
    await expect(sheet).toBeHidden();

    await app.close();
  });
});
