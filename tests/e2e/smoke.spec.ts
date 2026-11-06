import { test, expect } from 'playwright/test';
import { TEXT } from '../../src/shared/constants/text';
import { launchDemoApp } from './demo-app';


test.describe('launcher turn smoke (plan 46 S3)', () => {
  test('boot → send → approval → resolve → persisted transcript in desktop mode', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    await window.getByRole('textbox').fill('Remember: the demo assistant lives in the system tray.');
    await window.keyboard.press('Enter');

    const allowOnce = window.getByRole('button', { name: TEXT.APPROVAL_ALLOW_ONCE });
    await allowOnce.waitFor({ timeout: 45_000 });
    await allowOnce.click();

    await window.getByText('Saved to memory.').waitFor({ timeout: 45_000 });

    const desktopPromise = app.waitForEvent('window');
    await window.keyboard.press('Control+d');
    const desktop = await desktopPromise;
    await desktop.waitForLoadState('domcontentloaded');
    await desktop.getByText('Remember: the demo assistant lives in the system tray.').waitFor({ timeout: 45_000 });

    await app.close();
  });
});

test.describe('settings provider-form smoke (plan 46 S3)', () => {
  test('settings → provider edit → empty name → validation error copy', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    await window.keyboard.press('Control+e');
    const settingsButton = window.locator(`[title="${TEXT.LAUNCHER_SETTINGS_TITLE}"]`);
    await settingsButton.waitFor({ timeout: 30_000 });

    const settingsPromise = app.waitForEvent('window');
    await settingsButton.click();
    const settings = await settingsPromise;
    await settings.waitForLoadState('domcontentloaded');
    await settings.waitForSelector('#settings-root', { timeout: 60_000 });

    await settings.getByText(TEXT.SETTINGS_NAV_API).first().click();
    const actionsButton = settings.locator('[aria-label="Actions for Demo assistant (local mock)"]');
    await actionsButton.waitFor({ timeout: 30_000 });
    await actionsButton.click();
    await settings.getByRole('menuitem', { name: TEXT.EDIT_BUTTON }).click();

    await settings.getByText(TEXT.API_EDIT_PROVIDER).waitFor({ timeout: 30_000 });
    await settings.getByPlaceholder(TEXT.API_NAME_PLACEHOLDER).fill('');
    await settings.getByRole('button', { name: TEXT.API_SAVE_PROVIDER }).click();
    await settings.getByText(TEXT.API_NAME_REQUIRED).waitFor({ timeout: 30_000 });

    await app.close();
  });
});
