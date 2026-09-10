import { mkdir, stat, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const schema = z.object({
  path: z.string().describe('New file path. Must be inside a folder the user granted.'),
  content: z.string().describe('Initial text content of the file.'),
});

export const fileCreateTool: NativeToolDefinition<{ path: string; content: string }> = {
  name: 'file_create',
  description: 'Create a new text file inside a granted folder; fails if the file already exists.',
  schema,
  risk: 'state-changing',
  category: 'files',
  editableArgs: true,
  pathArgs: ['path'],
  timeoutMs: 10_000,
  resultCharCap: 500,
  summarize: (args) => `Create ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const resolved = resolveWithinGrantedRoots(roots, args.path);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.path)}`;
    }
    const exists = (await stat(resolved).catch(() => null)) !== null;
    if (exists) {
      return `Error: '${args.path}' already exists (use file_write to overwrite).`;
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, args.content, 'utf-8');
    return `Created ${resolved} (${args.content.length} chars).`;
  },
};
