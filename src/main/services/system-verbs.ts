import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildPowerInvocation } from '@main/ai/tools/native/power';
import { ThemeType } from '@shared/constants/themes';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 10_000;

export type SystemVerb = 'lock' | 'sleep' | 'empty-trash';

export interface SystemVerbInvocation {
  file: string;
  args: string[];
}

export type SystemVerbResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

type Exec = (file: string, args: string[], options: { timeout: number }) => Promise<unknown>;

export function buildSystemVerbInvocation(verb: SystemVerb, platform: NodeJS.Platform): SystemVerbInvocation {
  if (verb === 'lock' || verb === 'sleep') {
    return buildPowerInvocation(verb, platform);
  }
  if (platform === 'darwin') {
    return { file: 'osascript', args: ['-e', 'tell application "Finder" to empty trash'] };
  }
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'],
    };
  }
  return { file: 'gio', args: ['trash', '--empty'] };
}

export function nextTheme(current: string): ThemeType {
  return current === ThemeType.DARK ? ThemeType.CLASSIC : ThemeType.DARK;
}

const SUCCESS: Record<SystemVerb, string> = {
  lock: 'Screen locked.',
  sleep: 'Going to sleep.',
  'empty-trash': 'Trash emptied.',
};

export async function runSystemVerb(
  verb: SystemVerb,
  options: { platform?: NodeJS.Platform; exec?: Exec } = {}
): Promise<SystemVerbResult> {
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? (execFileAsync as Exec);
  const { file, args } = buildSystemVerbInvocation(verb, platform);
  try {
    await exec(file, args, { timeout: CMD_TIMEOUT });
    return { ok: true, text: SUCCESS[verb] };
  } catch (error) {
    const detail = ((error as Error)?.message ?? String(error)).slice(0, 200);
    return { ok: false, error: detail };
  }
}
