import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 5_000;

const schema = z.object({
  level: z.number().int().min(0).max(100).describe('Volume level from 0 (mute) to 100.'),
});

export const volumeSetTool: NativeToolDefinition<{ level: number }> = {
  name: 'volume_set',
  description: 'Set the system output volume (0-100).',
  schema,
  risk: 'state-changing',
  category: 'system',
  timeoutMs: 10_000,
  summarize: (args) => `Volume ${args.level}%`,
  async exec(args) {
    if (process.platform === 'linux') {
      await execFileAsync('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${args.level}%`], { timeout: CMD_TIMEOUT });
      return `Volume set to ${args.level}%.`;
    }
    if (process.platform === 'darwin') {
      await execFileAsync('osascript', ['-e', `set volume output volume ${args.level}`], { timeout: CMD_TIMEOUT });
      return `Volume set to ${args.level}%.`;
    }
    return 'Error: volume_set is not supported on this platform yet.';
  },
};
