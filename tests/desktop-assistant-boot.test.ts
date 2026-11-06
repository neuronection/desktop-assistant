import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir: string;

const windowManagerInstance = {
  createMainWindow: vi.fn(async () => ({ id: 1 })),
  loadApp: vi.fn(async () => undefined),
  setQuitting: vi.fn(),
  showMainWindow: vi.fn(),
  hideMainWindow: vi.fn(),
  toggleMainWindow: vi.fn(),
  refreshSpeechHud: vi.fn(),
  setHudMenuControls: vi.fn(),
  showSettingsWindow: vi.fn(),
  showDesktopWindow: vi.fn(),
  getMainWindow: vi.fn(() => null),
  on: vi.fn(),
};

const trayManagerInstance = {
  initialize: vi.fn(),
  showNotification: vi.fn(),
  setUnreadBadge: vi.fn(),
  setUpdateVersion: vi.fn(),
  on: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (_name: string) => dataDir,
    getAppPath: () => process.cwd(),
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
    on: vi.fn(),
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    requestSingleInstanceLock: vi.fn(() => true),
  },
  BrowserWindow: class {},
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  globalShortcut: {
    register: vi.fn(),
    unregisterAll: vi.fn(),
  },
}));

vi.mock('@main/window', () => ({
  WindowManager: class {
    constructor() {
      return windowManagerInstance;
    }
  },
}));

vi.mock('@main/tray', () => ({
  TrayManager: class {
    constructor() {
      return trayManagerInstance;
    }
  },
}));

vi.mock('@main/ipc-handlers', () => ({
  setupIpcHandlers: vi.fn(),
}));

const updateServiceOptions: Array<Record<string, unknown>> = [];

vi.mock('@main/services/updates', () => ({
  UpdateService: class {
    constructor(options: Record<string, unknown>) {
      updateServiceOptions.push(options);
    }
    start = vi.fn();
    stop = vi.fn();
    checkNow = vi.fn(async () => ({ release: null }));
  },
}));

const boot = async () => {
  const configMod = await import('@main/services/ConfigService');
  (configMod.MainConfigService as { instance?: unknown }).instance = undefined;
  const { DesktopAssistant } = await import('@main/DesktopAssistant');
  const { HotkeyService } = await import('@main/services/HotkeyService');
  (HotkeyService as { instance?: unknown }).instance = undefined;
  const assistant = new DesktopAssistant();
  await assistant.initialize();
  return assistant;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  updateServiceOptions.length = 0;
  dataDir = mkdtempSync(join(tmpdir(), 'da-boot-'));
});

describe('DesktopAssistant boot smoke (plan 46 S2, mocked Electron)', () => {
  it('boots config → database → window → hotkeys → ipc → tray in one pass', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const assistant = await boot();
    expect(assistant.getInitializationError()).toBeNull();
    expect(updateServiceOptions[0]).toMatchObject({ installerIsPackaged: false });
    expect(windowManagerInstance.createMainWindow).toHaveBeenCalledTimes(1);
    expect(windowManagerInstance.loadApp).toHaveBeenCalledTimes(1);
    expect(trayManagerInstance.initialize).toHaveBeenCalledTimes(1);
    expect(trayManagerInstance.showNotification).toHaveBeenCalled();
    const { setupIpcHandlers } = await import('@main/ipc-handlers');
    expect(setupIpcHandlers).toHaveBeenCalledTimes(1);
    const { protocol } = await import('electron');
    expect(protocol.handle).toHaveBeenCalledWith('speech-cache', expect.any(Function));
    consoleLog.mockRestore();
  });

  it('a second initialize() is a no-op (single boot)', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const assistant = await boot();
    await assistant.initialize();
    expect(windowManagerInstance.createMainWindow).toHaveBeenCalledTimes(1);
    consoleLog.mockRestore();
  });

  it('a failed boot reports through the logger and leaves the app uninitialized', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    windowManagerInstance.createMainWindow.mockRejectedValueOnce(new Error('window boom'));
    const configMod = await import('@main/services/ConfigService');
    (configMod.MainConfigService as { instance?: unknown }).instance = undefined;
    const { DesktopAssistant } = await import('@main/DesktopAssistant');
    const assistant = new DesktopAssistant();
    await assistant.initialize();
    expect(assistant.getInitializationError()).toBeInstanceOf(Error);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize'), expect.anything());
    expect(windowManagerInstance.loadApp).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('quit() marks the window manager quitting and quits the app', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { app } = await import('electron');
    const assistant = await boot();
    assistant.quit();
    expect(windowManagerInstance.setQuitting).toHaveBeenCalledWith(true);
    expect(app.quit).toHaveBeenCalled();
    consoleLog.mockRestore();
  });
});
