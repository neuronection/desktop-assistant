import { stat } from 'fs/promises';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const schema = z.object({
  path: z.string().describe('File or folder to delete (moved to the OS trash). Must be inside a granted folder.'),
});

export const fileDeleteTool: NativeToolDefinition<{ path: string }> = {
  name: 'file_delete',
  description:
    'Move a file or folder inside a granted folder to the OS trash (recoverable). Destructive: every call requires explicit user approval.',
  schema,
  risk: 'destructive',
  category: 'files',
  pathArgs: ['path'],
  timeoutMs: 10_000,
  resultCharCap: 300,
  summarize: (args) => `Delete ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const resolved = resolveWithinGrantedRoots(ctx.grantedRoots ?? [], args.path);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.path)}`;
    }
    const info = await stat(resolved).catch(() => null);
    if (!info) {
      return `Error: '${args.path}' does not exist.`;
    }
    const { shell } = await import('electron');
    try {
      await shell.trashItem(resolved);
    } catch (error) {
      return `Error: could not move '${args.path}' to the trash (${((error as Error).message ?? '').slice(0, 200)}).`;
    }
    return `Moved '${args.path}' to the trash.`;
  },
};
