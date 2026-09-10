import { z } from 'zod';
import { stat } from 'fs/promises';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const EXECUTABLE_EXTENSIONS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.bin',
  '.run',
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.msi',
  '.app',
  '.desktop',
  '.jar',
  '.apk',
  '.deb',
  '.rpm',
]);

const schema = z.object({
  path: z.string().describe('File or folder path to open with the default application.'),
});

export const openPathTool: NativeToolDefinition<{ path: string }> = {
  name: 'open_path',
  description:
    'Open a folder in the file manager, or a document with its default application. Folders may be anywhere; files must live inside a folder the user granted.',
  schema,
  risk: 'state-changing',
  category: 'desktop',
  timeoutMs: 10_000,
  summarize: (args) => `Open ${args.path}`,
  async exec(args, ctx: ToolExecContext) {
    const { shell } = await import('electron');
    const info = await stat(args.path).catch(() => null);
    if (!info) {
      return `Error: '${args.path}' does not exist.`;
    }
    if (!info.isDirectory()) {
      const lower = args.path.toLowerCase();
      if ([...EXECUTABLE_EXTENSIONS].some((ext) => lower.endsWith(ext))) {
        return 'Error: executable files cannot be opened. Ask the user to run it themselves.';
      }
      if (resolveWithinGrantedRoots(ctx.grantedRoots ?? [], args.path) === null) {
        return `Error: ${describeRootBreach(args.path)}`;
      }
    }
    const error = await shell.openPath(args.path);
    if (error) {
      return `Error: ${error}`;
    }
    return `Opened ${args.path}.`;
  },
};
