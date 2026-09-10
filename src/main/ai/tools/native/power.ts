import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export type PowerAction = 'lock' | 'sleep' | 'restart' | 'shutdown';

const schema = z.object({});

export interface PowerInvocation {
  file: string;
  args: string[];
}

/**
 * Per-OS command matrix — pure so it can be unit-tested per platform
 * without executing anything.
 */
export function buildPowerInvocation(action: PowerAction, platform: NodeJS.Platform): PowerInvocation {
  if (platform === 'darwin') {
    switch (action) {
      case 'lock':
        return { file: 'pmset', args: ['displaysleepnow'] };
      case 'sleep':
        return { file: 'pmset', args: ['sleepnow'] };
      case 'restart':
        return { file: 'osascript', args: ['-e', 'tell app "System Events" to restart'] };
      case 'shutdown':
        return { file: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] };
    }
  }
  if (platform === 'win32') {
    switch (action) {
      case 'lock':
        return { file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] };
      case 'sleep':
        return { file: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] };
      case 'restart':
        return { file: 'shutdown', args: ['/r', '/t', '0'] };
      case 'shutdown':
        return { file: 'shutdown', args: ['/s', '/t', '0'] };
    }
  }
  switch (action) {
    case 'lock':
      return { file: 'loginctl', args: ['lock-session'] };
    case 'sleep':
      return { file: 'systemctl', args: ['suspend'] };
    case 'restart':
      return { file: 'systemctl', args: ['reboot'] };
    case 'shutdown':
      return { file: 'systemctl', args: ['poweroff'] };
  }
}

const LABELS: Record<PowerAction, string> = {
  lock: 'Lock the session',
  sleep: 'Put the computer to sleep',
  restart: 'Restart the computer',
  shutdown: 'Shut the computer down',
};

const RISKS: Record<PowerAction, 'state-changing' | 'destructive'> = {
  lock: 'state-changing',
  sleep: 'state-changing',
  restart: 'destructive',
  shutdown: 'destructive',
};

function powerTool(action: PowerAction): NativeToolDefinition<Record<string, never>> {
  const risk = RISKS[action];
  return {
    name: `power_${action}`,
    description: `${LABELS[action]} immediately. ${
      risk === 'destructive' ? 'Destructive: every call requires explicit user approval.' : 'State-changing: asks unless approved or auto-run by policy.'
    }`,
    schema,
    risk,
    category: 'power',
    timeoutMs: CMD_TIMEOUT + 2_000,
    resultCharCap: 300,
    summarize: () => LABELS[action].toLowerCase(),
    async exec() {
      const { file, args } = buildPowerInvocation(action, process.platform);
      try {
        await execFileAsync(file, args, { timeout: CMD_TIMEOUT });
        return `${LABELS[action]} — command issued.`;
      } catch (error) {
        return `Error: could not ${action} (${((error as Error).message ?? String(error)).slice(0, 200)}).`;
      }
    },
  };
}

export const powerLockTool = powerTool('lock');
export const powerSleepTool = powerTool('sleep');
export const powerRestartTool = powerTool('restart');
export const powerShutdownTool = powerTool('shutdown');
