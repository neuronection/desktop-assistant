import { readFile, stat } from 'fs/promises';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const MAX_BYTES = 512 * 1024;

const schema = z.object({
  path: z.string().describe('File path to read. Must be inside a folder the user granted.'),
});

export const readFileTool: NativeToolDefinition<{ path: string }> = {
  name: 'read_file',
  description: 'Read a text file. Only works inside folders the user granted access to.',
  schema,
  risk: 'read-only',
  category: 'files',
  pathArgs: ['path'],
  timeoutMs: 10_000,
  summarize: (args) => `Read ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    const resolved = resolveWithinGrantedRoots(roots, args.path);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.path)}`;
    }
    const info = await stat(resolved).catch(() => null);
    if (!info) {
      return `Error: '${args.path}' does not exist.`;
    }
    if (info.isDirectory()) {
      return `Error: '${args.path}' is a folder (use list_dir).`;
    }
    if (info.size > MAX_BYTES) {
      return `Error: file is ${Math.round(info.size / 1024)} KB, larger than the ${MAX_BYTES / 1024} KB read cap.`;
    }
    const buffer = await readFile(resolved);
    if (buffer.subarray(0, 8000).includes(0)) {
      return 'Error: file appears to be binary; only text files can be read.';
    }
    return `Contents of ${resolved}:\n${buffer.toString('utf-8')}`;
  },
};
