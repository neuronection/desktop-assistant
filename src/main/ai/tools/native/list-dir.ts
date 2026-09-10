import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const MAX_ENTRIES = 200;

const schema = z.object({
  path: z.string().describe('Folder path to list. Must be inside a folder the user granted.'),
  depth: z.number().int().min(1).max(3).optional().describe('Recursion depth (default 1).'),
});

export const listDirTool: NativeToolDefinition<{ path: string; depth?: number }> = {
  name: 'list_dir',
  description: 'List the contents of a folder. Only works inside folders the user granted access to.',
  schema,
  risk: 'read-only',
  category: 'files',
  pathArgs: ['path'],
  timeoutMs: 10_000,
  resultCharCap: 8_000,
  summarize: (args) => `List ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const resolved = resolveWithinGrantedRoots(roots, args.path);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.path)}`;
    }
    const lines: string[] = [];
    const walk = async (dir: string, depth: number): Promise<boolean> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
      if (entries === null) {
        lines.push(`${dir}: not readable`);
        return false;
      }
      for (const entry of entries) {
        if (lines.length >= MAX_ENTRIES) {
          lines.push(`…and more (capped at ${MAX_ENTRIES} entries)`);
          return true;
        }
        const child = join(dir, entry.name);
        lines.push(`${entry.isDirectory() ? 'd' : '-'} ${child}`);
        if (entry.isDirectory() && depth > 1) {
          if (await walk(child, depth - 1)) {
            return true;
          }
        }
      }
      return false;
    };
    const depth = args.depth ?? 1;
    const info = await stat(resolved).catch(() => null);
    if (!info?.isDirectory()) {
      return `Error: '${args.path}' is not a folder.`;
    }
    await walk(resolved, depth);
    if (lines.length === 0) {
      return `The folder '${resolved}' is empty.`;
    }
    return `Contents of ${resolved}:\n${lines.join('\n')}`;
  },
};
