import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const execFileAsync = promisify(execFile);

export const SHELL_DEFAULT_TIMEOUT_MS = 10_000;
export const SHELL_HARD_CAP_TIMEOUT_MS = 60_000;
const SHELL_OUTPUT_CAP = 10_000;

const schema = z.object({
  command: z.string().min(1).describe('The shell command to run (batch mode: no interactive input).'),
  cwd: z.string().optional().describe('Working directory. Must be inside a folder the user granted.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(SHELL_HARD_CAP_TIMEOUT_MS)
    .optional()
    .describe(`Timeout in ms (default ${SHELL_DEFAULT_TIMEOUT_MS / 1000}s, hard cap ${SHELL_HARD_CAP_TIMEOUT_MS / 1000}s).`),
});

/**
 * The child gets a minimal environment: never inherit the Electron
 * process env wholesale (it can carry tokens/keys).
 */
export function scrubbedShellEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: 'dumb',
  };
}

export function shellInvocation(command: string): { file: string; args: string[] } {
  return process.platform === 'win32'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { file: '/bin/bash', args: ['-c', command] };
}

interface ShellOutcome {
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  failed?: boolean;
}

export const runShellTool: NativeToolDefinition<{ command: string; cwd?: string; timeoutMs?: number }> = {
  name: 'run_shell',
  description:
    'Run a shell command on this computer and return its combined output. Batch mode only (no interactive/TTY programs). Destructive: every call requires explicit user approval.',
  schema,
  risk: 'destructive',
  category: 'system',
  timeoutMs: SHELL_HARD_CAP_TIMEOUT_MS + 5_000,
  resultCharCap: SHELL_OUTPUT_CAP,
  summarize: (args) => args.command,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const requestedCwd = args.cwd ?? roots[0];
    if (requestedCwd === undefined) {
      return 'Error: no granted folder is available. Grant a folder in Settings → Tools to use run_shell.';
    }
    const cwd = resolveWithinGrantedRoots(roots, requestedCwd);
    if (cwd === null) {
      return `Error: ${describeRootBreach(requestedCwd)}`;
    }
    const timeoutMs = Math.min(args.timeoutMs ?? SHELL_DEFAULT_TIMEOUT_MS, SHELL_HARD_CAP_TIMEOUT_MS);
    const { file, args: execArgs } = shellInvocation(args.command);

    const outcome: ShellOutcome = await new Promise((resolve) => {
      execFileAsync(file, execArgs, {
        cwd,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        env: scrubbedShellEnv(),
        windowsHide: true,
        maxBuffer: 2 * SHELL_OUTPUT_CAP,
      }).then(
        ({ stdout, stderr }) => resolve({ stdout, stderr }),
        (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean }) => {
          if (error.killed) {
            resolve({ timedOut: true });
            return;
          }
          if (error.stdout !== undefined || error.stderr !== undefined) {
            resolve({ stdout: error.stdout, stderr: error.stderr, failed: true });
            return;
          }
          resolve({ failed: true, stderr: error.message });
        }
      );
    });

    if (outcome.timedOut) {
      return `Error: command killed after the ${Math.round(timeoutMs / 1000)}s timeout.`;
    }
    const stdout = (outcome.stdout ?? '').trimEnd();
    const stderr = (outcome.stderr ?? '').trimEnd();
    const parts: string[] = [];
    if (stdout) {
      parts.push(stdout);
    }
    if (stderr) {
      parts.push(`stderr:\n${stderr}`);
    }
    if (outcome.failed) {
      parts.push('(command exited non-zero)');
    }
    return parts.length ? parts.join('\n') : '(no output)';
  },
};
