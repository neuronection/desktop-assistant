import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const MAX_APPS = 150;

const schema = z.object({});

async function listLinuxMacApps(): Promise<string[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'comm='], { timeout: 5_000 });
  return stdout
    .split('\n')
    .map((line) => line.trim().split('/').pop() ?? line.trim())
    .filter((name) => name.length > 0);
}

async function listWindowsApps(): Promise<string[]> {
  const { stdout } = await execFileAsync('tasklist', ['/fo', 'csv', '/nh'], { timeout: 10_000 });
  return stdout
    .split('\n')
    .map((line) => line.split('","')[0]?.replace(/^"/, '').trim() ?? '')
    .filter((name) => name.length > 0);
}

export const listAppsTool: NativeToolDefinition<Record<string, never>> = {
  name: 'list_apps',
  description: 'List the names of running applications/processes on this computer.',
  schema,
  risk: 'read-only',
  category: 'system',
  timeoutMs: 15_000,
  summarize: () => 'Listed running apps',
  async exec() {
    const names = process.platform === 'win32' ? await listWindowsApps() : await listLinuxMacApps();
    if (names.length === 0) {
      return 'No running processes were found.';
    }
    const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    const shown = unique.slice(0, MAX_APPS);
    const suffix = unique.length > shown.length ? `\n…and ${unique.length - shown.length} more` : '';
    return `Running apps/processes (${unique.length} unique):\n${shown.join(', ')}${suffix}`;
  },
};
