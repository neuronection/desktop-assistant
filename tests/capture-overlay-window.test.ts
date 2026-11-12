import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureOverlaySession } from '@shared/capture';

interface FakeWindowHandle {
  options: Record<string, unknown>;
  webContents: {
    sent: Array<{ channel: string; payload: unknown }>;
    emit: (event: string, ...args: unknown[]) => void;
  };
  emit: (event: string, ...args: unknown[]) => void;
  destroyed: boolean;
  visible: boolean;
  focus: ReturnType<typeof vi.fn>;
}

const created: FakeWindowHandle[] = [];

vi.mock('electron', () => {
  class FakeWebContents {
    public sent: Array<{ channel: string; payload: unknown }> = [];
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    public setWindowOpenHandler = (): void => undefined;
    public on(event: string, callback: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(callback);
      this.handlers.set(event, list);
    }
    public send(channel: string, payload?: unknown): void {
      this.sent.push({ channel, payload });
    }
    public emit(event: string, ...args: unknown[]): void {
      for (const callback of this.handlers.get(event) ?? []) {
        callback(...args);
      }
    }
  }
  class FakeBrowserWindow {
    public webContents = new FakeWebContents();
    public destroyed = false;
    public visible = false;
    public focus = vi.fn();
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor(public options: Record<string, unknown>) {
      created.push(this as unknown as FakeWindowHandle);
    }
    public isDestroyed(): boolean {
      return this.destroyed;
    }
    public destroy(): void {
      this.destroyed = true;
      this.emit('closed');
    }
    public async loadURL(): Promise<void> {}
    public async loadFile(): Promise<void> {}
    public show(): void {
      this.visible = true;
    }
    public setAlwaysOnTop(): void {}
    public setVisibleOnAllWorkspaces(): void {}
    public setMenuBarVisibility(): void {}
    public on(event: string, callback: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(callback);
      this.handlers.set(event, list);
    }
    public emit(event: string, ...args: unknown[]): void {
      for (const callback of this.handlers.get(event) ?? []) {
        callback(...args);
      }
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getAllDisplays: () => [
        { id: 7, bounds: { x: 100, y: 50, width: 1200, height: 900 }, scaleFactor: 2 },
      ],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
  };
});

import { CaptureOverlayController } from '@main/services/capture/overlay';

const session: CaptureOverlaySession = {
  sessionId: 'capture-1',
  display: { id: 7, width: 1200, height: 900, scaleFactor: 2 },
  preview: 'data:image/jpeg;base64,AAAA',
  windows: [],
  armed: null,
  hint: 'Click a window',
};

function controller(): CaptureOverlayController {
  return new CaptureOverlayController({ isDev: true, preloadPath: '/tmp/preload.js' });
}

beforeEach(() => {
  created.length = 0;
});

describe('capture overlay window', () => {
  it('covers exactly the target display and pushes the session once ready', async () => {
    const overlay = controller();
    const pending = overlay.open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    const window = created[0];
    expect(window.options).toMatchObject({ x: 100, y: 50, width: 1200, height: 900, frame: false });
    await vi.waitFor(() => expect(window.visible).toBe(true));

    expect(window.webContents.sent).toHaveLength(0);
    overlay.markReady();
    expect(window.webContents.sent).toEqual([{ channel: 'capture:session', payload: session }]);

    overlay.commit({ kind: 'display' });
    await expect(pending).resolves.toEqual({ selection: { kind: 'display' } });
  });

  it('resolves a cancel and refuses a stale commit', async () => {
    const overlay = controller();
    const pending = overlay.open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(overlay.commit({ kind: 'display' })).toBe(true);
    await expect(pending).resolves.toEqual({ selection: { kind: 'display' } });
    expect(overlay.commit({ kind: 'display' })).toBe(false);
  });

  it('treats a renderer crash as a cancel, not a resurrection', async () => {
    const overlay = controller();
    const pending = overlay.open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0]?.webContents.emit('render-process-gone');
    await expect(pending).resolves.toEqual({ selection: null });
    expect(created[0]?.destroyed).toBe(true);
  });

  it('resolves null when the user closes the window', async () => {
    const overlay = controller();
    const pending = overlay.open(session);
    await vi.waitFor(() => expect(created).toHaveLength(1));
    created[0]?.emit('closed');
    await expect(pending).resolves.toEqual({ selection: null });
  });

  it('never opens two overlays at once', async () => {
    const overlay = controller();
    const first = overlay.open(session);
    const second = overlay.open({ ...session, sessionId: 'capture-2' });
    await vi.waitFor(() => expect(created.length).toBe(2));
    await expect(first).resolves.toEqual({ selection: null });
    expect(created[0]?.destroyed).toBe(true);
    overlay.cancel();
    await expect(second).resolves.toEqual({ selection: null });
  });
});
