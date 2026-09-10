import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const schema = z.object({
  pid: z.number().int().positive().describe('Process ID (PID) of the process to terminate.'),
});

const SIGKILL_GRACE_MS = 3_000;

export const killProcessTool: NativeToolDefinition<{ pid: number }> = {
  name: 'kill_process',
  description:
    'Terminate a process by PID (SIGTERM, escalating to SIGKILL). Destructive: every call requires explicit user approval.',
  schema,
  risk: 'destructive',
  category: 'system',
  timeoutMs: SIGKILL_GRACE_MS + 5_000,
  resultCharCap: 300,
  summarize: (args) => `Kill process ${args.pid}`,
  async exec(args) {
    if (args.pid <= 1) {
      return 'Error: refusing to kill PID 1 (init).';
    }
    if (args.pid === process.pid) {
      return 'Error: refusing to kill the assistant itself.';
    }
    let alive = true;
    try {
      process.kill(args.pid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      return `No process with PID ${args.pid} is running.`;
    }
    process.kill(args.pid, 'SIGTERM');
    const exited = await new Promise<boolean>((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        try {
          process.kill(args.pid, 0);
        } catch {
          alive = false;
          clearInterval(poll);
          resolve(true);
          return;
        }
        if (Date.now() - started > SIGKILL_GRACE_MS) {
          clearInterval(poll);
          resolve(false);
        }
      }, 200);
    });
    if (!exited) {
      try {
        process.kill(args.pid, 'SIGKILL');
        return `Process ${args.pid} ignored SIGTERM; sent SIGKILL.`;
      } catch {
        return `Process ${args.pid} terminated.`;
      }
    }
    return `Process ${args.pid} terminated.`;
  },
};
