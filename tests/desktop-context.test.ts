import { describe, it, expect, vi } from 'vitest';
import { DesktopContextService, hashText, isWaylandSession } from '@main/services/DesktopContextService';
import type { AppConfig } from '@shared/config/AppConfig';

function makeConfig(overrides: { clipboardWatcher?: boolean } = {}): AppConfig {
  return { behavior: { clipboardWatcher: overrides.clipboardWatcher ?? false } } as unknown as AppConfig;
}

function fakeClipboard(initial = '') {
  const state: Record<'content' | 'primary', string> = { content: initial, primary: '' };
  return {
    state,
    api: {
      readText: () => state.content,
      selection: {
        readText: () => state.primary,
      },
    },
  };
}

function withPlatform(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, run: () => void): void {
  const originalPlatform = process.platform;
  const originalSession = process.env.XDG_SESSION_TYPE;
  const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  if (env.XDG_SESSION_TYPE === undefined) {
    delete process.env.XDG_SESSION_TYPE;
  } else {
    process.env.XDG_SESSION_TYPE = env.XDG_SESSION_TYPE;
  }
  if (env.WAYLAND_DISPLAY === undefined) {
    delete process.env.WAYLAND_DISPLAY;
  } else {
    process.env.WAYLAND_DISPLAY = env.WAYLAND_DISPLAY;
  }
  try {
    run();
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    if (originalSession === undefined) {
      delete process.env.XDG_SESSION_TYPE;
    } else {
      process.env.XDG_SESSION_TYPE = originalSession;
    }
    if (originalWaylandDisplay === undefined) {
      delete process.env.WAYLAND_DISPLAY;
    } else {
      process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
    }
  }
}

describe('selection support matrix', () => {
  it('offers keyless primary reads on X11 linux only', () => {
    withPlatform('linux', { XDG_SESSION_TYPE: 'x11' }, () => {
      expect(new DesktopContextService().selectionSupported()).toBe(true);
    });
    withPlatform('linux', { XDG_SESSION_TYPE: 'wayland' }, () => {
      expect(new DesktopContextService().selectionSupported()).toBe(false);
    });
    withPlatform('linux', { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: '' }, () => {
      expect(new DesktopContextService().selectionSupported()).toBe(false);
    });
    withPlatform('darwin', {}, () => {
      expect(new DesktopContextService().selectionSupported()).toBe(false);
    });
    withPlatform('win32', {}, () => {
      expect(new DesktopContextService().selectionSupported()).toBe(false);
    });
    expect(isWaylandSession({})).toBe(false);
  });

  it('never injects keystrokes: capture reads the primary buffer as-is', async () => {
    const { api, state } = fakeClipboard('previous-clipboard-untouched');
    state.primary = 'the selected text';
    const service = new DesktopContextService({ clipboard: api });
    let pending: Promise<unknown> | null = null;
    withPlatform('linux', { XDG_SESSION_TYPE: 'x11' }, () => {
      pending = service.captureSelection();
    });
    await expect(pending).resolves.toEqual({ ok: true, text: 'the selected text' });
    expect(state.content).toBe('previous-clipboard-untouched');
  });

  it('reports no-selection when the primary buffer is empty', async () => {
    const { api } = fakeClipboard('something-else');
    const service = new DesktopContextService({ clipboard: api });
    let pending: Promise<unknown> | null = null;
    withPlatform('linux', { XDG_SESSION_TYPE: 'x11' }, () => {
      pending = service.captureSelection();
    });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: 'No selection was captured.',
    });
  });

  it('refuses selection capture on Wayland without touching the clipboard', async () => {
    const service = new DesktopContextService();
    let result: { ok: boolean; error?: string } | null = null;
    withPlatform('linux', { XDG_SESSION_TYPE: 'wayland' }, () => {
      void service.captureSelection().then((value) => {
        result = value;
      });
    });
    await vi.waitFor(() => expect(result).not.toBeNull());
    expect(result!.ok).toBe(false);
    expect(result!.error).toContain('not supported');
  });
});

describe('hashText', () => {
  it('is stable and content-sensitive', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
    expect(hashText('hello')).not.toBe(hashText('hellp'));
  });
});

describe('DesktopContextService clipboard watcher', () => {
  it('reports no clipboard change while the watcher is off', async () => {
    const { api } = fakeClipboard('changed content');
    const service = new DesktopContextService({
      getConfig: () => makeConfig({ clipboardWatcher: false }),
      clipboard: api,
    });
    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });
  });

  it('establishes a baseline on first poll and flags real changes after', async () => {
    const { api, state } = fakeClipboard('first content');
    const service = new DesktopContextService({
      getConfig: () => makeConfig({ clipboardWatcher: true }),
      clipboard: api,
    });

    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });
    state.content = 'brand new clipboard text';
    const change = await service.clipboardChanged();
    expect(change.changed).toBe(true);
    expect(change.text).toBe('brand new clipboard text');
    expect(change.preview).toBe('brand new clipboard text');

    state.content = 'brand new clipboard text';
    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });

    state.content = '';
    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });
  });

  it('does not flag the first real content as a change after empty polls', async () => {
    const { api, state } = fakeClipboard('   ');
    const service = new DesktopContextService({
      getConfig: () => makeConfig({ clipboardWatcher: true }),
      clipboard: api,
    });
    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });
    state.content = 'new text';
    await expect(service.clipboardChanged()).resolves.toEqual({ changed: false });
    state.content = 'newer text';
    await expect(service.clipboardChanged()).resolves.toEqual({
      changed: true,
      text: 'newer text',
      preview: 'newer text',
    });
  });
});
