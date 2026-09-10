import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { access, readdir } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const timeoutMs = 15_000;

const schema = z.object({
  name: z.string().describe('Name of the application to launch, e.g. "firefox" or "Visual Studio Code".'),
});

const XDG_DATA_DIRS = ['/usr/local/share/applications', '/usr/share/applications', '/usr/share/applications/kde', '~/.local/share/applications'];

async function findDesktopEntry(name: string): Promise<string | null> {
  const lower = `${name.toLowerCase()}.desktop`;
  const dirs = XDG_DATA_DIRS.map((dir) => (dir.startsWith('~') ? join(process.env.HOME ?? '', dir.slice(1)) : dir));
  for (const dir of dirs) {
    const files = await readdir(dir).catch(() => []);
    const match = files.find((file) => file.toLowerCase() === lower || file.toLowerCase().includes(lower));
    if (match) {
      return join(dir, match).replace(/\.desktop$/, '');
    }
  }
  return null;
}

async function launch(name: string): Promise<string> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', name], { timeout: timeoutMs });
    return name;
  }
  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', name], { timeout: timeoutMs, windowsVerbatimArguments: true });
    return name;
  }
  const entry = await findDesktopEntry(name);
  if (entry) {
    await execFileAsync('gtk-launch', [entry], { timeout: timeoutMs });
    return name;
  }
  await access(name, constants.X_OK).catch(() => {
    throw new Error(`No application or executable named '${name}' was found.`);
  });
  spawn(name, [], { detached: true, stdio: 'ignore' }).unref();
  return name;
}

export const openAppTool: NativeToolDefinition<{ name: string }> = {
  name: 'open_app',
  description: 'Launch an application on this computer by name.',
  schema,
  risk: 'state-changing',
  category: 'desktop',
  timeoutMs: 20_000,
  summarize: (args) => `Launch ${args.name}`,
  async exec(args) {
    const launched = await launch(args.name);
    return `Launched ${launched}.`;
  },
};
