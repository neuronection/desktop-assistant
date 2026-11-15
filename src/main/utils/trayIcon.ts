import { existsSync } from 'fs';
import { join } from 'path';

/**
 * The tray icon per platform. macOS wants a monochrome *Template* image so
 * the menu bar can tint it; the template is the glyph on transparent black.
 * If a host ever ships without it, fall back to the colour icon instead of
 * handing `new Tray()` an empty image (which throws and leaves the app with
 * no tray at all — the 2026-11 macOS regression).
 */
export function trayIconPathFor(iconsDir: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return join(iconsDir, 'tray-icon.ico');
  }
  if (platform === 'darwin') {
    const template = join(iconsDir, 'tray-iconTemplate.png');
    return existsSync(template) ? template : join(iconsDir, 'tray-icon.png');
  }
  return join(iconsDir, 'tray-icon.png');
}
