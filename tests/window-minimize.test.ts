import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dataDir: string;

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];
  readonly options: unknown;
  readonly calls: string[] = [];
  readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  readonly webContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
  };
  state = { shown: true, minimized: false, destroyed: false };

  constructor(options: unknown) {
    this.options = options;
    FakeBrowserWindow.instances.push(this);
  }

  on(name: string, handler: (...args: unknown[]) => void): void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  once(name: string, handler: (...args: unknown[]) => void): void {
    this.on(name, handler);
  }

  emit(name: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(name) ?? []) handler(...args);
  }

  listenerCount = (name: string): number => (this.handlers.get(name) ?? []).length;

  isDestroyed = (): boolean => this.state.destroyed;
  isMinimized = (): boolean => this.state.minimized;
  isVisible = (): boolean => this.state.shown && !this.state.minimized;
  restore = (): void => {
    this.calls.push('restore');
    this.state.minimized = false;
  };
  hide = (): void => {
    this.calls.push('hide');
    this.state.shown = false;
  };
  show = vi.fn();
  moveTop = vi.fn();
  focus = vi.fn();
  setMenuBarVisibility = vi.fn();
  setAutoHideMenuBar = vi.fn();
  getSize = (): [number, number] => [650, 400];
  getPosition = (): [number, number] => [100, 100];
  getBounds = (): { x: number; y: number; width: number; height: number } => ({
    x: 100,
    y: 100,
    width: 650,
    height: 400,
  });
  setPosition = vi.fn();
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (_name: string) => dataDir,
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
  },
  BrowserWindow: FakeBrowserWindow,
  nativeImage: {
    createFromPath: vi.fn(() => ({})),
  },
  shell: {
    openExternal: vi.fn(async () => {}),
  },
  screen: {
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

const makeManager = async () => {
  const configMod = await import('@main/services/ConfigService');
  (configMod.MainConfigService as { instance?: unknown }).instance = undefined;
  const { WindowManager } = await import('@main/window');
  const manager = new WindowManager();
  await manager.createMainWindow();
  const window = FakeBrowserWindow.instances[0];
  return { manager, window };
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  FakeBrowserWindow.instances = [];
  dataDir = mkdtempSync(join(tmpdir(), 'da-window-'));
});

describe('launcher window minimize law', () => {
  it('converts every launcher minimize into hide-to-tray — the single dismissal verb', async () => {
    const { window } = await makeManager();

    window.state.minimized = true;
    window.emit('minimize');

    expect(window.calls).toEqual(['restore', 'hide']);
    expect(window.state.shown).toBe(false);
  });

  it('hideMainWindow restores a minimized window before hiding (Cinnamon/Mutter unmapped-strand guard)', async () => {
    const { manager, window } = await makeManager();

    window.state.minimized = true;
    window.state.shown = true;
    manager.hideMainWindow();

    expect(window.calls).toEqual(['restore', 'hide']);
    expect(window.state.shown).toBe(false);
  });

  it('hideMainWindow does not restore a window that is not minimized', async () => {
    const { manager, window } = await makeManager();

    manager.hideMainWindow();

    expect(window.calls).toEqual(['hide']);
  });
});
