import { app } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { AutostartStatus } from '@shared/types';

const DESKTOP_ENTRY_ID = 'desktop-assistant.desktop';

export class ResidencyService {
  private static instance: ResidencyService;
  private applied: boolean | null = null;

  private constructor() {}

  static getInstance(): ResidencyService {
    if (!ResidencyService.instance) {
      ResidencyService.instance = new ResidencyService();
    }
    return ResidencyService.instance;
  }

  getStatus(): AutostartStatus {
    return { supported: this.isSupported(), enabled: this.readEnabled() };
  }

  apply(autostart: boolean): void {
    if (this.applied === autostart) {
      return;
    }
    if (autostart && !this.isSupported()) {
      console.warn('Autostart requested but not supported here (development build or unsupported platform); ignoring.');
      return;
    }
    try {
      if (process.platform === 'linux') {
        this.applyXdgAutostart(autostart);
      } else if (process.platform === 'win32') {
        app.setLoginItemSettings({ openAtLogin: autostart, args: ['--hidden'] });
      } else {
        app.setLoginItemSettings({ openAtLogin: autostart });
      }
      this.applied = autostart;
      console.log(`Login item ${autostart ? 'enabled' : 'disabled'} (${process.platform})`);
    } catch (error) {
      console.error('Failed to update login item settings:', error);
    }
  }

  private isSupported(): boolean {
    if (!app.isPackaged) {
      return false;
    }
    return ['linux', 'win32', 'darwin'].includes(process.platform);
  }

  private readEnabled(): boolean {
    try {
      if (process.platform === 'linux') {
        return existsSync(this.desktopEntryPath());
      }
      if (process.platform === 'win32') {
        return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
      }
      if (process.platform === 'darwin') {
        return app.getLoginItemSettings().openAtLogin;
      }
    } catch {
      return false;
    }
    return false;
  }

  private desktopEntryPath(): string {
    const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
    return join(configHome, 'autostart', DESKTOP_ENTRY_ID);
  }

  private applyXdgAutostart(enable: boolean): void {
    const entryPath = this.desktopEntryPath();
    if (!enable) {
      rmSync(entryPath, { force: true });
      return;
    }
    mkdirSync(dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, this.desktopEntryContents(), 'utf-8');
  }

  private desktopEntryContents(): string {
    const execPath = /\s/.test(process.execPath) ? `"${process.execPath}"` : process.execPath;
    return [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      `Name=${app.getName()}`,
      `Exec=${execPath} --hidden`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
  }
}
