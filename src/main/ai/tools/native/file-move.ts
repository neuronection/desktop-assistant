import { mkdir, rename, stat } from 'fs/promises';
import { dirname } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const schema = z.object({
  from: z.string().describe('Source file or folder path (inside a granted folder).'),
  to: z.string().describe('Destination path (inside a granted folder).'),
});

export const fileMoveTool: NativeToolDefinition<{ from: string; to: string }> = {
  name: 'file_move',
  description: 'Move or rename a file or folder between locations inside the granted folders.',
  schema,
  risk: 'state-changing',
  category: 'files',
  editableArgs: true,
  pathArgs: ['from', 'to'],
  timeoutMs: 10_000,
  resultCharCap: 500,
  summarize: (args) => `Move ${args.from} → ${args.to}`,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const from = resolveWithinGrantedRoots(roots, args.from);
    const to = resolveWithinGrantedRoots(roots, args.to);
    if (from === null) {
      return `Error: ${describeRootBreach(args.from)}`;
    }
    if (to === null) {
      return `Error: ${describeRootBreach(args.to)}`;
    }
    const info = await stat(from).catch(() => null);
    if (!info) {
      return `Error: '${args.from}' does not exist.`;
    }
    if ((await stat(to).catch(() => null)) !== null) {
      return `Error: '${args.to}' already exists.`;
    }
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return `Moved ${from} → ${to}.`;
  },
};
