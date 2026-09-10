import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export interface WindowInfo {
  app: string;
  title: string;
  pid?: number;
  desktop?: number;
}

export interface CommandSpec {
  file: string;
  args: string[];
}

/** Per-OS matrix — pure so each platform's command is unit-testable. */
export function buildWindowListInvocation(platform: NodeJS.Platform): CommandSpec {
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e',
        [
          'tell application "System Events"',
          'set output to ""',
          'repeat with p in (application processes whose visible is true)',
          'set pname to name of p',
          'repeat with w in windows of p',
          'set output to output & pname & " | " & (title of w as text) & linefeed',
          'end repeat',
          'end repeat',
          'return output',
          'end tell',
        ].join('\n'),
      ],
    };
  }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        'Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)|$($_.Id)" }',
      ],
    };
  }
  return { file: 'wmctrl', args: ['-lxp'] };
}

export function buildActiveWindowInvocation(platform: NodeJS.Platform): CommandSpec {
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e',
        [
          'tell application "System Events"',
          'set frontApp to first application process whose frontmost is true',
          'set appName to name of frontApp',
          'try',
          'set windowTitle to title of front window of frontApp',
          'on error',
          'set windowTitle to ""',
          'end try',
          'return appName & " | " & windowTitle',
          'end tell',
        ].join('\n'),
      ],
    };
  }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        [
          '$sig = "[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n); [DllImport(\\"user32.dll\\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);"',
          'Add-Type -MemberDefinition $sig -Name FG -Namespace Win32',
          '$h = [Win32.FG]::GetForegroundWindow()',
          '$sb = New-Object System.Text.StringBuilder 512',
          '[void][Win32.FG]::GetWindowText($h, $sb, 512)',
          '$pid2 = 0',
          '[void][Win32.FG]::GetWindowThreadProcessId($h, [ref]$pid2)',
          '$p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue',
          '"$($p.ProcessName)|$($sb.ToString())"',
        ].join('; '),
      ],
    };
  }
  return { file: 'xdotool', args: ['getactivewindow', 'getwindowname'] };
}

/** `wmctrl -lxp` rows: ID, desktop, pid, host, WM_CLASS(instance.class), title… */
export function parseWmctrlOutput(stdout: string): WindowInfo[] {
  const windows: WindowInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }
    const desktop = Number.parseInt(parts[1], 10);
    const pid = Number.parseInt(parts[2], 10);
    const fullClass = parts[4] ?? '';
    const app = fullClass.split('.').pop() ?? fullClass;
    const title = parts.slice(5).join(' ');
    windows.push({
      app: app || 'unknown',
      title,
      pid: Number.isFinite(pid) ? pid : undefined,
      desktop: Number.isFinite(desktop) ? desktop : undefined,
    });
  }
  return windows;
}

/** macOS AppleScript rows: "App | Title" (empty rows skipped). */
export function parseAppleWindowLines(stdout: string): WindowInfo[] {
  const windows: WindowInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf('|');
    if (separator === -1) {
      windows.push({ app: trimmed.trim(), title: '' });
      continue;
    }
    windows.push({ app: trimmed.slice(0, separator).trim(), title: trimmed.slice(separator + 1).trim() });
  }
  return windows;
}

/** Windows PowerShell rows: "ProcessName|Title|Pid". */
export function parsePowerShellWindowLines(stdout: string): WindowInfo[] {
  const windows: WindowInfo[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [app = '', title = '', pidRaw = ''] = trimmed.split('|');
    const pid = Number.parseInt(pidRaw, 10);
    if (!app) {
      continue;
    }
    windows.push({ app, title, pid: Number.isFinite(pid) ? pid : undefined });
  }
  return windows;
}

export function parseWindowsForPlatform(platform: NodeJS.Platform, stdout: string): WindowInfo[] {
  if (platform === 'darwin') {
    return parseAppleWindowLines(stdout);
  }
  if (platform === 'win32') {
    return parsePowerShellWindowLines(stdout);
  }
  return parseWmctrlOutput(stdout);
}

export function formatWindows(windows: WindowInfo[], limit: number): string {
  return windows
    .slice(0, limit)
    .map((window) => {
      const extras: string[] = [];
      if (window.pid !== undefined) {
        extras.push(`pid ${window.pid}`);
      }
      if (window.desktop !== undefined) {
        extras.push(`desktop ${window.desktop}`);
      }
      const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      return `- ${window.app}: ${window.title || '(no title)'}${suffix}`;
    })
    .join('\n');
}

function missingBinaryMessage(spec: CommandSpec): string {
  return `Not available on this system (needs ${spec.file}).`;
}

async function runCommand(spec: CommandSpec): Promise<string> {
  try {
    const { stdout } = await execFileAsync(spec.file, spec.args, {
      timeout: CMD_TIMEOUT,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new BinaryMissingError(missingBinaryMessage(spec));
    }
    throw error;
  }
}

export class BinaryMissingError extends Error {}

const windowListSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Maximum windows to list (default 15).'),
});

export const windowListTool: NativeToolDefinition<{ limit?: number }> = {
  name: 'window_list',
  description: 'List the currently open windows: app name, window title, and where available pid/desktop. Read-only.',
  schema: windowListSchema,
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: CMD_TIMEOUT + 2_000,
  resultCharCap: 4_000,
  summarize: () => 'List open windows',
  async exec(args) {
    const spec = buildWindowListInvocation(process.platform);
    let stdout: string;
    try {
      stdout = await runCommand(spec);
    } catch (error) {
      if (error instanceof BinaryMissingError) {
        return error.message;
      }
      return `Error: could not list windows (${((error as Error).message ?? String(error)).slice(0, 200)}).`;
    }
    const windows = parseWindowsForPlatform(process.platform, stdout);
    if (windows.length === 0) {
      return 'No windows found.';
    }
    return formatWindows(windows, args.limit ?? 15);
  },
};

export const activeWindowTool: NativeToolDefinition<Record<string, never>> = {
  name: 'active_window',
  description: 'Report the currently focused window: app name and window title. Read-only.',
  schema: z.object({}),
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: CMD_TIMEOUT + 2_000,
  resultCharCap: 600,
  summarize: () => 'Get active window',
  async exec() {
    const spec = buildActiveWindowInvocation(process.platform);
    let stdout: string;
    try {
      stdout = await runCommand(spec);
    } catch (error) {
      if (error instanceof BinaryMissingError) {
        return error.message;
      }
      return `Error: could not determine the active window (${((error as Error).message ?? String(error)).slice(0, 200)}).`;
    }
    const title = stdout.trim();
    if (!title) {
      return 'Could not determine the active window.';
    }
    if (process.platform !== 'linux') {
      const [app = '', ...rest] = title.split('|');
      const windowTitle = rest.join('|').trim();
      return `Active window — ${app.trim() || 'unknown'}: ${windowTitle || '(no title)'}`;
    }
    let app = 'unknown';
    try {
      const list = parseWmctrlOutput((await execFileAsync('wmctrl', ['-lx'], { timeout: CMD_TIMEOUT })).stdout);
      const match = list.find((window) => window.title === title);
      if (match) {
        app = match.app;
      }
    } catch {
      // title-only output is acceptable
    }
    return `Active window — ${app}: ${title}`;
  },
};
