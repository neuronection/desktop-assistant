import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export interface ProcessInfo {
  name: string;
  pid: number;
  /** Percent of CPU (ps) — unavailable via tasklist. */
  cpu?: number;
  /** Percent of memory (ps) or KB resident (tasklist). */
  mem?: number;
}

export interface CommandSpec {
  file: string;
  args: string[];
}

export function buildProcessListInvocation(platform: NodeJS.Platform): CommandSpec {
  if (platform === 'win32') {
    return { file: 'tasklist.exe', args: ['/fo', 'csv', '/nh'] };
  }
  return { file: 'ps', args: ['-eo', 'pid,pcpu,pmem,comm'] };
}

export function parsePsOutput(stdout: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('PID')) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }
    const pid = Number.parseInt(parts[0], 10);
    const cpu = Number.parseFloat(parts[1]);
    const mem = Number.parseFloat(parts[2]);
    if (!Number.isFinite(pid)) {
      continue;
    }
    rows.push({
      name: parts.slice(3).join(' '),
      pid,
      cpu: Number.isFinite(cpu) ? cpu : undefined,
      mem: Number.isFinite(mem) ? mem : undefined,
    });
  }
  return rows;
}

/** Minimal quoted-CSV parse for `tasklist /fo csv /nh`: name,pid,session,sess-num,mem. */
export function parseTasklistOutput(stdout: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const fields = trimmed
      .match(/"([^"]*)"/g)
      ?.map((field) => field.slice(1, -1));
    if (!fields || fields.length < 5) {
      continue;
    }
    const pid = Number.parseInt(fields[1], 10);
    const mem = Number.parseFloat(fields[4].replace(/[",]/g, '').replace(/K/i, ''));
    if (!Number.isFinite(pid)) {
      continue;
    }
    rows.push({ name: fields[0], pid, mem: Number.isFinite(mem) ? mem : undefined });
  }
  return rows;
}

export function parseProcessesForPlatform(platform: NodeJS.Platform, stdout: string): ProcessInfo[] {
  if (platform === 'win32') {
    return parseTasklistOutput(stdout);
  }
  return parsePsOutput(stdout);
}

/** CPU desc, then memory desc; unavailable metrics sort last. */
export function sortProcesses(processes: ProcessInfo[]): ProcessInfo[] {
  return [...processes].sort((a, b) => {
    const cpuA = a.cpu ?? -1;
    const cpuB = b.cpu ?? -1;
    if (cpuA !== cpuB) {
      return cpuB - cpuA;
    }
    const memA = a.mem ?? -1;
    const memB = b.mem ?? -1;
    if (memA !== memB) {
      return memB - memA;
    }
    return a.pid - b.pid;
  });
}

export function formatProcesses(processes: ProcessInfo[], limit: number): string {
  return processes
    .slice(0, limit)
    .map((proc) => {
      const extras: string[] = [];
      if (proc.cpu !== undefined) {
        extras.push(`cpu ${proc.cpu.toFixed(1)}%`);
      }
      if (proc.mem !== undefined) {
        extras.push(`mem ${proc.mem.toFixed(1)}%`);
      }
      const suffix = extras.length > 0 ? ` — ${extras.join(', ')}` : '';
      return `- ${proc.name} (pid ${proc.pid})${suffix}`;
    })
    .join('\n');
}

const schema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Maximum processes to list (default 25).'),
});

export const processListTool: NativeToolDefinition<{ limit?: number }> = {
  name: 'process_list',
  description:
    'List running processes: name, pid, and where available cpu/memory usage (sorted by CPU). Read-only counterpart to kill_process.',
  schema,
  risk: 'read-only',
  category: 'system',
  timeoutMs: CMD_TIMEOUT + 2_000,
  resultCharCap: 6_000,
  summarize: () => 'List running processes',
  async exec(args) {
    const spec = buildProcessListInvocation(process.platform);
    let stdout: string;
    try {
      const result = await execFileAsync(spec.file, spec.args, {
        timeout: CMD_TIMEOUT,
        maxBuffer: 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return `Not available on this system (needs ${spec.file}).`;
      }
      return `Error: could not list processes (${((error as Error).message ?? String(error)).slice(0, 200)}).`;
    }
    const processes = sortProcesses(parseProcessesForPlatform(process.platform, stdout));
    if (processes.length === 0) {
      return 'No processes found.';
    }
    return formatProcesses(processes, args.limit ?? 25);
  },
};
