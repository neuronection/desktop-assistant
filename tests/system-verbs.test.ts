import { describe, expect, it, vi } from 'vitest';
import { buildSystemVerbInvocation, nextTheme, runSystemVerb } from '@main/services/system-verbs';

describe('buildSystemVerbInvocation', () => {
  it('uses the native power matrix for lock and sleep', () => {
    expect(buildSystemVerbInvocation('lock', 'linux')).toEqual({ file: 'loginctl', args: ['lock-session'] });
    expect(buildSystemVerbInvocation('sleep', 'darwin')).toEqual({ file: 'pmset', args: ['sleepnow'] });
    expect(buildSystemVerbInvocation('lock', 'win32')).toEqual({
      file: 'rundll32.exe',
      args: ['user32.dll,LockWorkStation'],
    });
  });

  it('uses the platform trash service without a shell string', () => {
    expect(buildSystemVerbInvocation('empty-trash', 'linux')).toEqual({ file: 'gio', args: ['trash', '--empty'] });
    expect(buildSystemVerbInvocation('empty-trash', 'darwin').file).toBe('osascript');
    expect(buildSystemVerbInvocation('empty-trash', 'win32').file).toBe('powershell.exe');
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(buildSystemVerbInvocation('empty-trash', platform).args.join(' ')).not.toContain(';');
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
