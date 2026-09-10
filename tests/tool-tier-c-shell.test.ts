import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildLangChainTool } from '@main/ai/tools/registry';
import {
  runShellTool,
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_HARD_CAP_TIMEOUT_MS,
  scrubbedShellEnv,
  shellInvocation,
} from '@main/ai/tools/native/run-shell';
import { buildPowerInvocation } from '@main/ai/tools/native/power';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-shell-'));
  await writeFile(join(root, 'marker.txt'), 'inside', 'utf-8');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (grantedRoots: string[]) => ({ grantedRoots });

describe('run_shell', () => {
  it.skipIf(process.platform === 'win32')('runs a command in a granted cwd and captures stdout', async () => {
    const result = await runShellTool.exec({ command: 'cat marker.txt' }, ctx([root]));
    expect(result).toBe('inside');
  });

  it.skipIf(process.platform === 'win32')('rejects working directories outside the granted roots', async () => {
    const result = await runShellTool.exec({ command: 'ls', cwd: '/etc' }, ctx([root]));
    expect(result).toContain('Error:');
    expect(result).toContain('was not granted');
    expect(await runShellTool.exec({ command: 'ls' }, ctx([]))).toContain('no granted folder');
  });

  it.skipIf(process.platform === 'win32')('defaults cwd to the granted root when omitted', async () => {
    const result = await runShellTool.exec({ command: 'pwd' }, ctx([root]));
    const physical = await realpath(root);
    expect(result).toBe(physical);
  });

  it.skipIf(process.platform === 'win32')('captures stderr and non-zero exits without throwing', async () => {
    const result = await runShellTool.exec({ command: 'echo boom >&2; exit 3' }, ctx([root]));
    expect(result).toContain('boom');
    expect(result).toContain('non-zero');
  });

  it.skipIf(process.platform === 'win32')('kills a command that exceeds its timeout', async () => {
    const result = await runShellTool.exec({ command: 'sleep 30', timeoutMs: 1000 }, ctx([root]));
    expect(result).toContain('timeout');
  }, 15_000);

  it('caps the requested timeout at the hard cap (schema + clamp)', () => {
    expect(runShellTool.schema.safeParse({ command: 'x', timeoutMs: 999_999_999 }).success).toBe(false);
    expect(runShellTool.schema.safeParse({ command: 'x', timeoutMs: SHELL_HARD_CAP_TIMEOUT_MS }).success).toBe(true);
    expect(Math.min(999_999_999, SHELL_HARD_CAP_TIMEOUT_MS)).toBe(60_000);
  });

  it.skipIf(process.platform === 'win32')('does not leak the parent environment into the child (hostile env fixture)', async () => {
    process.env.DA_CANARY_SECRET = 'super-secret-token';
    try {
      const result = await runShellTool.exec({ command: 'printenv DA_CANARY_SECRET || echo clean' }, ctx([root]));
      expect(result).toBe('clean');
    } finally {
      delete process.env.DA_CANARY_SECRET;
    }
  });

  it.skipIf(process.platform === 'win32')('survives hostile output (huge output capped at the registry layer)', async () => {
    const built = buildLangChainTool(runShellTool, ctx([root]));
    const result = (await built.invoke({ command: 'head -c 100000 /dev/zero | tr "\\0" "x"' })) as string;
    expect(result.length).toBeLessThanOrEqual(11_000);
    expect(result).toContain('truncated');
  }, 15_000);

  it.skipIf(process.platform === 'win32')('keeps the batch contract (no TTY)', async () => {
    const result = await runShellTool.exec({ command: '[ -t 0 ] && echo tty || echo batch' }, ctx([root]));
    expect(result).toBe('batch');
  });

  it('exposes sane defaults', () => {
    expect(SHELL_DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(SHELL_HARD_CAP_TIMEOUT_MS).toBe(60_000);
    expect(runShellTool.risk).toBe('destructive');
    expect(runShellTool.summarize({ command: 'ls -la' })).toBe('ls -la');
  });

  it('builds per-OS invocations', () => {
    const posix = process.platform !== 'win32';
    expect(shellInvocation('ls').file).toBe(posix ? '/bin/bash' : 'cmd.exe');
    expect(shellInvocation('ls').args).toEqual(posix ? ['-c', 'ls'] : ['/d', '/s', '/c', 'ls']);
    expect(scrubbedShellEnv().TERM).toBe('dumb');
    expect(scrubbedShellEnv().DA_CANARY_SECRET).toBeUndefined();
  });
});

describe('power command matrix (no execution)', () => {
  it('maps actions per platform', () => {
    expect(buildPowerInvocation('lock', 'linux')).toEqual({ file: 'loginctl', args: ['lock-session'] });
    expect(buildPowerInvocation('sleep', 'linux')).toEqual({ file: 'systemctl', args: ['suspend'] });
    expect(buildPowerInvocation('restart', 'linux')).toEqual({ file: 'systemctl', args: ['reboot'] });
    expect(buildPowerInvocation('shutdown', 'darwin')).toEqual({
      file: 'osascript',
      args: ['-e', 'tell app "System Events" to shut down'],
    });
    expect(buildPowerInvocation('lock', 'darwin')).toEqual({ file: 'pmset', args: ['displaysleepnow'] });
    expect(buildPowerInvocation('restart', 'win32')).toEqual({ file: 'shutdown', args: ['/r', '/t', '0'] });
    expect(buildPowerInvocation('shutdown', 'win32')).toEqual({ file: 'shutdown', args: ['/s', '/t', '0'] });
    expect(buildPowerInvocation('sleep', 'win32').file).toBe('rundll32.exe');
  });
});
