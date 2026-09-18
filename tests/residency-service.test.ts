import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { app as mockedApp } from 'electron';

const setLoginItemSettings = vi.fn();
const getLoginItemSettings = vi.fn();

vi.mock('electron', () => ({
  app: {
    setLoginItemSettings: (...args: unknown[]) => setLoginItemSettings(...args),
    getLoginItemSettings: (...args: unknown[]) => getLoginItemSettings(...args),
    getName: () => 'Desktop Assistant',
    isPackaged: true,
  },
}));

const freshService = async () => {
  const mod = await import('@main/services/ResidencyService');
  (mod.ResidencyService as unknown as { instance: unknown }).instance = undefined;
  return mod.ResidencyService.getInstance();
};

const REAL_PLATFORM = process.platform;
const REAL_EXEC_PATH = process.execPath;
const REAL_XDG = process.env.XDG_CONFIG_HOME;

let configHome: string;

const setPlatform = (platform: string): void => {
  Object.defineProperty(process, 'platform', { value: platform });
};
const setExecPath = (value: string): void => {
  Object.defineProperty(process, 'execPath', { value });
};
const setPackaged = (value: boolean): void => {
  (mockedApp as unknown as { isPackaged: boolean }).isPackaged = value;
};
const entryPath = (): string => join(configHome, 'autostart', 'desktop-assistant.desktop');

beforeEach(() => {
  vi.clearAllMocks();
  configHome = mkdtempSync(join(tmpdir(), 'da-residency-'));
  process.env.XDG_CONFIG_HOME = configHome;
  setPlatform('linux');
  setExecPath(REAL_EXEC_PATH);
  setPackaged(true);
});

afterEach(() => {
  rmSync(configHome, { recursive: true, force: true });
  setPlatform(REAL_PLATFORM);
  setExecPath(REAL_EXEC_PATH);
  setPackaged(true);
  if (REAL_XDG === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = REAL_XDG;
  }
});

describe('ResidencyService (linux, XDG autostart)', () => {
  it('writes an autostart desktop entry with the hidden flag and reads it back', async () => {
    setExecPath('/opt/Desktop Assistant/desktop-assistant');
    const service = await freshService();
    service.apply(true);

    expect(existsSync(entryPath())).toBe(true);
    const contents = readFileSync(entryPath(), 'utf-8');
    expect(contents).toContain('[Desktop Entry]');
    expect(contents).toContain('Name=Desktop Assistant');
    expect(contents).toContain('Exec="/opt/Desktop Assistant/desktop-assistant" --hidden');
    expect(contents).toContain('Terminal=false');
    expect(service.getStatus()).toEqual({ supported: true, enabled: true });
  });

  it('does not quote a space-free exec path', async () => {
    setExecPath('/usr/bin/desktop-assistant');
    const service = await freshService();
    service.apply(true);
    expect(readFileSync(entryPath(), 'utf-8')).toContain('Exec=/usr/bin/desktop-assistant --hidden');
  });

  it('removes the entry on disable and reports it disabled', async () => {
    const service = await freshService();
    service.apply(true);
    service.apply(false);
    expect(existsSync(entryPath())).toBe(false);
    expect(service.getStatus()).toEqual({ supported: true, enabled: false });
  });

  it('reports disabled when the entry was never written', async () => {
    const service = await freshService();
    expect(service.getStatus()).toEqual({ supported: true, enabled: false });
  });

  it('fails soft when the autostart directory cannot be created', async () => {
    const blocker = join(configHome, 'blocker');
    writeFileSync(blocker, 'not a directory', 'utf-8');
    process.env.XDG_CONFIG_HOME = blocker;
    const service = await freshService();
    expect(() => service.apply(true)).not.toThrow();
  });
});

describe('ResidencyService (win32 / darwin login items)', () => {
  it('registers with the --hidden arg on Windows and reads the matching entry back', async () => {
    setPlatform('win32');
    getLoginItemSettings.mockReturnValue({ openAtLogin: true });
    const service = await freshService();
    service.apply(true);
    const status = service.getStatus();

    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] });
    expect(getLoginItemSettings).toHaveBeenCalledWith({ args: ['--hidden'] });
    expect(status).toEqual({ supported: true, enabled: true });
  });

  it('registers without args on macOS', async () => {
    setPlatform('darwin');
    getLoginItemSettings.mockReturnValue({ openAtLogin: false });
    const service = await freshService();
    service.apply(true);

    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(service.getStatus()).toEqual({ supported: true, enabled: false });
  });

  it('does not rewrite unchanged state', async () => {
    setPlatform('win32');
    const service = await freshService();
    service.apply(true);
    service.apply(true);
    expect(setLoginItemSettings).toHaveBeenCalledTimes(1);
  });

  it('fails soft when the OS refuses the login item', async () => {
    setPlatform('win32');
    setLoginItemSettings.mockImplementation(() => {
      throw new Error('not supported');
    });
    const service = await freshService();
    expect(() => service.apply(true)).not.toThrow();
  });
});

describe('ResidencyService (development build guard)', () => {
  it('refuses to enable from a dev build and reports unsupported', async () => {
    setPackaged(false);
    const service = await freshService();

    service.apply(true);
    expect(existsSync(entryPath())).toBe(false);
    expect(setLoginItemSettings).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual({ supported: false, enabled: false });
  });

  it('still allows disabling from a dev build (cleanup)', async () => {
    setPackaged(false);
    setPlatform('win32');
    const service = await freshService();

    service.apply(false);
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, args: ['--hidden'] });
  });
});
