import { describe, it, expect } from 'vitest';
import {
  DesktopContextService,
  hashText,
  isWaylandSession,
  type DesktopExec,
} from '@main/services/DesktopContextService';
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

const X11 = { XDG_SESSION_TYPE: 'x11' } as NodeJS.ProcessEnv;
const WAYLAND = { XDG_SESSION_TYPE: 'wayland' } as NodeJS.ProcessEnv;

function execReturning(stdout: string): DesktopExec {
  return async () => stdout;
}

const execMissing: DesktopExec = async () => {
  const error = new Error('spawn wl-paste ENOENT') as Error & { code: string };
  error.code = 'ENOENT';
  throw error;
};

describe('selection support matrix (plan 58 §4.5)', () => {
  it('offers keyless primary reads on X11 linux only', async () => {
    expect(await new DesktopContextService({ platform: 'linux', env: X11 }).selectionSupported()).toBe(true);
    expect(
      await new DesktopContextService({ platform: 'darwin', env: {} }).selectionSupported()
    ).toBe(false);
    expect(
      await new DesktopContextService({ platform: 'win32', env: {} }).selectionSupported()
    ).toBe(false);
    expect(isWaylandSession({})).toBe(false);
  });

  it('is honest on Wayland: unsupported without wl-paste, best-effort with it', async () => {
    expect(
      await new DesktopContextService({ platform: 'linux', env: WAYLAND, exec: execMissing }).selectionSupported()
    ).toBe(false);
    expect(
      await new DesktopContextService({
        platform: 'linux',
        env: { WAYLAND_DISPLAY: 'wayland-0' },
        exec: execReturning('wl-paste 2.2'),
      }).selectionSupported()
    ).toBe(true);
  });

  it('treats a wl-paste usage error as present (the binary exists)', async () => {
    const usageError: DesktopExec = async () => {
      const error = new Error('unrecognized option') as Error & { code: number };
      error.code = 1;
      throw error;
    };
    expect(
      await new DesktopContextService({ platform: 'linux', env: WAYLAND, exec: usageError }).selectionSupported()
    ).toBe(true);
  });
});

describe('readPrimarySelection', () => {
  it('never injects keystrokes: reads the primary buffer as-is', async () => {
    const { api, state } = fakeClipboard('previous-clipboard-untouched');
    state.primary = 'the selected text';
    const service = new DesktopContextService({ clipboard: api, platform: 'linux', env: X11 });
    await expect(service.readPrimarySelection()).resolves.toEqual({ ok: true, text: 'the selected text' });
    expect(state.content).toBe('previous-clipboard-untouched');
  });

  it('reports no_selection when the primary buffer is empty', async () => {
    const { api } = fakeClipboard('something-else');
    const service = new DesktopContextService({ clipboard: api, platform: 'linux', env: X11 });
    await expect(service.readPrimarySelection()).resolves.toMatchObject({
      ok: false,
      reason: 'no_selection',
      error: 'No selection was captured.',
    });
  });

  it('reports unsupported on Wayland without wl-paste', async () => {
    const service = new DesktopContextService({ platform: 'linux', env: WAYLAND, exec: execMissing });
    const result = await service.readPrimarySelection();
    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(result.error).toContain('not supported');
  });

  it('falls back to a constrained wl-paste argv read on Wayland', async () => {
    const calls: { file: string; args: string[]; timeout: number }[] = [];
    const exec: DesktopExec = async (file, args, options) => {
      calls.push({ file, args, timeout: options.timeout });
      return args.includes('--version') ? 'wl-paste 2.2' : '  clipboard selection  ';
    };
    const service = new DesktopContextService({ platform: 'linux', env: WAYLAND, exec });
    await expect(service.readPrimarySelection()).resolves.toEqual({ ok: true, text: 'clipboard selection' });
    const read = calls.find((call) => call.args.includes('--primary'));
    expect(read).toEqual({ file: 'wl-paste', args: ['--primary', '--no-newline'], timeout: 300 });
  });

  it('uses the wl-paste fallback when Electron yields an empty primary', async () => {
    const { api } = fakeClipboard();
    const service = new DesktopContextService({
      clipboard: api,
      platform: 'linux',
      env: X11,
      exec: execReturning('fallback text'),
    });
    await expect(service.readPrimarySelection()).resolves.toEqual({ ok: true, text: 'fallback text' });
  });

  it('reports no_selection when both readers come back empty', async () => {
    const { api } = fakeClipboard();
    const empty: DesktopExec = async (file, args) => (args.includes('--version') ? 'wl-paste 2.2' : '   ');
    const service = new DesktopContextService({ clipboard: api, platform: 'linux', env: WAYLAND, exec: empty });
    await expect(service.readPrimarySelection()).resolves.toMatchObject({ ok: false, reason: 'no_selection' });
  });

  it('reads the clipboard for the speak-clipboard fallback', async () => {
    const { api, state } = fakeClipboard('  clipboard text  ');
    const service = new DesktopContextService({ clipboard: api });
    await expect(service.readClipboard()).resolves.toBe('clipboard text');
    state.content = '';
    await expect(service.readClipboard()).resolves.toBe('');
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
