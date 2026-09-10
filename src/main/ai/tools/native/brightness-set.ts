import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const execFileAsync = promisify(execFile);
const CMD_TIMEOUT = 5_000;

const schema = z.object({
  level: z.number().int().min(0).max(100).describe('Screen brightness percentage (0-100).'),
});

export const brightnessSetTool: NativeToolDefinition<{ level: number }> = {
  name: 'brightness_set',
  description: 'Set the built-in display brightness (0-100), where supported.',
  schema,
  risk: 'state-changing',
  category: 'system',
  timeoutMs: 10_000,
  summarize: (args) => `Brightness ${args.level}%`,
  async exec(args) {
    if (process.platform === 'linux') {
      await execFileAsync('brightnessctl', ['set', `${args.level}%`], { timeout: CMD_TIMEOUT });
      return `Brightness set to ${args.level}%.`;
    }
    return 'Error: brightness_set is not supported on this platform yet.';
  },
};
