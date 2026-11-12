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
      args: ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; try { Clear-RecycleBin -Force -ErrorAction Stop } catch { if ($_.Exception.Message -notmatch 'empty') { throw } }"],
    };
  }
  return { file: 'gio', args: ['trash', '--empty'] };
}

export function systemCommandsAllowed(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path === '/' || path.endsWith('/index.html');
  } catch {
    return false;
  }
}

export function nextTheme(current: string): ThemeType {
  return current === ThemeType.DARK ? ThemeType.CLASSIC : ThemeType.DARK;
}

export interface TrashConfirmationStrings {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  cancelled: string;
}

export interface MessageBoxProvider {
  showMessageBox(options: {
    type: 'warning';
    buttons: string[];
    defaultId: number;
    cancelId: number;
    noLink: boolean;
    title: string;
    message: string;
    detail: string;
  }): Promise<{ response: number }>;
}

export async function confirmEmptyTrash(
  dialog: MessageBoxProvider,
  run: () => Promise<SystemVerbResult>,
  strings: TrashConfirmationStrings
): Promise<SystemVerbResult> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: [strings.cancel, strings.confirm],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: strings.title,
    message: strings.title,
    detail: strings.body,
  });
  if (response !== 1) {
    return { ok: true, text: strings.cancelled };
  }
  return run();
}

export interface ThemeConfigProvider {
  getConfig(): { theme: string };
  updateTheme(theme: string): Promise<void>;
}

export interface ThemeBroadcastWindow {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: { theme: string }): void;
  };
}

export async function toggleTheme(
  config: ThemeConfigProvider,
  windows: () => ThemeBroadcastWindow[]
): Promise<{ ok: true; theme: ThemeType } | { ok: false; error: string }> {
  try {
    const next = nextTheme(config.getConfig().theme);
    await config.updateTheme(next);
    for (const window of windows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('config-updated', { theme: next });
      }
    }
    return { ok: true, theme: next };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message ?? String(error) };
  }
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
    const hint =
      verb === 'empty-trash' && platform === 'darwin'
        ? ' Grant Desktop Assistant Automation access to Finder in System Settings → Privacy & Security → Automation.'
        : '';
    return { ok: false, error: `${detail}${hint}` };
  }
}
