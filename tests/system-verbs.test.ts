import { describe, expect, it, vi } from 'vitest';
import { buildSystemVerbInvocation, confirmEmptyTrash, nextTheme, runSystemVerb, systemCommandsAllowed, toggleTheme } from '@main/services/system-verbs';

describe('buildSystemVerbInvocation', () => {
  it('uses the native power matrix for lock and sleep', () => {
    expect(buildSystemVerbInvocation('lock', 'linux')).toEqual({ file: 'loginctl', args: ['lock-session'] });
    expect(buildSystemVerbInvocation('sleep', 'darwin')).toEqual({ file: 'pmset', args: ['sleepnow'] });
    expect(buildSystemVerbInvocation('lock', 'win32')).toEqual({
      file: 'rundll32.exe',
      args: ['user32.dll,LockWorkStation'],
    });
  });

  it('uses the platform trash service with fixed argv', () => {
    expect(buildSystemVerbInvocation('empty-trash', 'linux')).toEqual({ file: 'gio', args: ['trash', '--empty'] });
    expect(buildSystemVerbInvocation('empty-trash', 'darwin').file).toBe('osascript');
    expect(buildSystemVerbInvocation('empty-trash', 'win32').file).toBe('powershell.exe');
    expect(buildSystemVerbInvocation('empty-trash', 'win32').args.join(' ')).toContain('-ErrorAction Stop');
    expect(buildSystemVerbInvocation('empty-trash', 'win32').args.join(' ')).toContain('Namespace(10)');
    expect(buildSystemVerbInvocation('empty-trash', 'win32').args.join(' ')).toContain('try { Clear-RecycleBin');
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const invocation = buildSystemVerbInvocation('empty-trash', platform);
      expect(invocation.args.join(' ')).not.toContain('&&');
      expect(['sh', 'bash', 'cmd.exe']).not.toContain(invocation.file);
    }
  });
});

describe('nextTheme', () => {
  it('toggles between dark and classic', () => {
    expect(nextTheme('Dark')).toBe('Classic');
    expect(nextTheme('Classic')).toBe('Dark');
    expect(nextTheme('Nature')).toBe('Dark');
  });
});

describe('systemCommandsAllowed', () => {
  it('accepts only the launcher/desktop surface', () => {
    expect(systemCommandsAllowed('file:///app/index.html')).toBe(true);
    expect(systemCommandsAllowed('http://localhost:5173/index.html?desktop=1')).toBe(true);
    expect(systemCommandsAllowed('http://localhost:5173/')).toBe(true);
    expect(systemCommandsAllowed('file:///app/pack-window.html')).toBe(false);
    expect(systemCommandsAllowed('file:///app/result-viewer.html')).toBe(false);
    expect(systemCommandsAllowed('not a url')).toBe(false);
  });
});

describe('confirmEmptyTrash', () => {
  const strings = { title: 'Empty?', body: 'Gone.', confirm: 'Empty', cancel: 'Cancel', cancelled: 'Cancelled.' };

  it('runs only after the destructive button', async () => {
    const run = vi.fn(async () => ({ ok: true as const, text: 'Trash emptied.' }));
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 1 })) };
    await expect(confirmEmptyTrash(dialog, run, strings)).resolves.toEqual({ ok: true, text: 'Trash emptied.' });
    expect(run).toHaveBeenCalledOnce();
  });

  it('cancels without running the verb', async () => {
    const run = vi.fn(async () => ({ ok: true as const, text: 'Trash emptied.' }));
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
    await expect(confirmEmptyTrash(dialog, run, strings)).resolves.toEqual({ ok: true, text: 'Cancelled.' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('toggleTheme', () => {
  it('persists and broadcasts to live windows only', async () => {
    const config = { getConfig: () => ({ theme: 'Dark' }), updateTheme: vi.fn(async () => undefined) };
    const send = vi.fn();
    const result = await toggleTheme(config, () => [
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send } },
    ]);
    expect(result).toEqual({ ok: true, theme: 'Classic' });
    expect(config.updateTheme).toHaveBeenCalledWith('Classic');
    expect(send).toHaveBeenCalledWith('config-updated', { theme: 'Classic' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('reports a persistence failure', async () => {
    const config = {
      getConfig: () => ({ theme: 'Classic' }),
      updateTheme: async () => {
        throw new Error('read-only config');
      },
    };
    await expect(toggleTheme(config, () => [])).resolves.toEqual({ ok: false, error: 'read-only config' });
  });
});

describe('runSystemVerb', () => {
  it('reports success after the invocation settles', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const result = await runSystemVerb('lock', { platform: 'linux', exec });
    expect(result).toEqual({ ok: true, text: 'Screen locked.' });
    expect(exec).toHaveBeenCalledWith('loginctl', ['lock-session'], { timeout: 10_000 });
  });

  it('returns a bounded error instead of throwing', async () => {
    const exec = vi.fn(async () => {
      throw new Error('no session bus');
    });
    const result = await runSystemVerb('empty-trash', { platform: 'linux', exec });
    expect(result).toEqual({ ok: false, error: 'no session bus' });
  });
});
