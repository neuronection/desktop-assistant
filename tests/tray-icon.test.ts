import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { trayIconPathFor } from '@main/utils/trayIcon';

const repoIcons = join(process.cwd(), 'assets', 'icons');

describe('tray icon per platform', () => {
  it('ships a macOS template image plus its retina variant', () => {
    const path = trayIconPathFor(repoIcons, 'darwin');
    expect(path).toBe(join(repoIcons, 'tray-iconTemplate.png'));
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(repoIcons, 'tray-iconTemplate@2x.png'))).toBe(true);
  });

  it('ships the Windows and Linux icons', () => {
    expect(existsSync(trayIconPathFor(repoIcons, 'win32'))).toBe(true);
    expect(existsSync(trayIconPathFor(repoIcons, 'linux'))).toBe(true);
  });

  it('falls back to the colour icon when a host has no template', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tray-icon-'));
    writeFileSync(join(dir, 'tray-icon.png'), 'png');
    expect(trayIconPathFor(dir, 'darwin')).toBe(join(dir, 'tray-icon.png'));
  });
});
