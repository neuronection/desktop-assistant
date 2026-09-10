import { mkdir, stat, writeFile, appendFile } from 'fs/promises';
import { dirname } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const schema = z.object({
  path: z.string().describe('File path to write. Must be inside a folder the user granted.'),
  content: z.string().describe('The text content to write.'),
  append: z.boolean().optional().describe('Append instead of replacing the file (default false).'),
});

export const fileWriteTool: NativeToolDefinition<{ path: string; content: string; append?: boolean }> = {
  name: 'file_write',
  description:
    'Create or overwrite a text file inside a granted folder (parent folders are created as needed). Use append=true to add to an existing file.',
  schema,
  risk: 'state-changing',
  category: 'files',
  editableArgs: true,
  pathArgs: ['path'],
  timeoutMs: 10_000,
  resultCharCap: 500,
  summarize: (args) => `${args.append ? 'Append to' : 'Write'} ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const resolved = resolveWithinGrantedRoots(roots, args.path);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.path)}`;
    }
    const info = await stat(resolved).catch(() => null);
    if (info?.isDirectory()) {
      return `Error: '${args.path}' is a folder.`;
    }
    await mkdir(dirname(resolved), { recursive: true });
    if (args.append) {
      await appendFile(resolved, args.content, 'utf-8');
    } else {
      await writeFile(resolved, args.content, 'utf-8');
    }
    return `${args.append ? 'Appended to' : 'Wrote'} ${resolved} (${args.content.length} chars).`;
  },
};
