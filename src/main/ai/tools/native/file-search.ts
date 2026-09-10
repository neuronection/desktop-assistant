import { readdir, readFile, stat } from 'fs/promises';
import { basename, join } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'target', '.cache', 'coverage', '.idea', '.vscode',
]);
const MAX_FILES_SCANNED = 20_000;
const MAX_TREE_DEPTH = 32;
const SEARCH_TIME_BUDGET_MS = 10_000;
const GREP_MAX_FILE_BYTES = 1_000_000;
const GREP_MAX_MATCHES_PER_FILE = 20;
const GREP_LINE_CHAR_CAP = 200;

interface ScanBudget {
  files: number;
  deadline: number;
  truncated: boolean;
}

export function newBudget(): ScanBudget {
  return { files: 0, deadline: Date.now() + SEARCH_TIME_BUDGET_MS, truncated: false };
}

function budgetSpent(budget: ScanBudget): boolean {
  return budget.truncated || budget.files >= MAX_FILES_SCANNED || Date.now() > budget.deadline;
}

/**
 * Iterative traversal of one granted root. Symlinked directories and
 * files are skipped entirely — a link is the one way a "confined"
 * search could read outside the granted roots. Junk directories from
 * SKIP_DIRS are pruned; every path is re-checked against the root.
 */
export async function walkRoot(
  root: string,
  visit: (absolute: string, relativePath: string) => void | Promise<void>,
  budget: ScanBudget
): Promise<void> {
  const stack: { absolute: string; relativePath: string; depth: number }[] = [
    { absolute: root, relativePath: '', depth: 0 },
  ];
  while (stack.length > 0) {
    if (budgetSpent(budget)) {
      budget.truncated = true;
      return;
    }
    const current = stack.pop() as { absolute: string; relativePath: string; depth: number };
    const entries = await readdir(current.absolute, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      if (budgetSpent(budget)) {
        budget.truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
      const absolute = join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || current.depth >= MAX_TREE_DEPTH) {
          continue;
        }
        stack.push({ absolute, relativePath, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        budget.files += 1;
        await visit(absolute, relativePath);
      }
    }
  }
}

/** Translates a glob (`*`, `**`, `?`) into a case-insensitive full-match regex. */
export function globToRegex(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          pattern += '(?:.*/)?';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

function matchesGlob(relativePath: string, regex: RegExp, globHasSlash: boolean): boolean {
  if (regex.test(relativePath)) {
    return true;
  }
  return !globHasSlash && regex.test(basename(relativePath));
}

interface SearchArgs {
  pattern: string;
  root?: string;
  limit?: number;
}

function resolveSearchRoots(args: SearchArgs, ctx: ToolExecContext): string[] | string {  const granted = ctx.grantedRoots ?? [];
  if (args.root !== undefined) {
    const resolved = resolveWithinGrantedRoots(granted, args.root);
    if (resolved === null) {
      return `Error: ${describeRootBreach(args.root)}`;
    }
    return [resolved];
  }
  if (granted.length === 0) {
    return 'Error: no granted folder is available. Grant a folder in Settings → Tools to use file search.';
  }
  return granted;
}

const findSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe('Glob pattern to match file names, e.g. "*.ts", "report*", "src/**/*.json". Matches the file name unless the pattern contains a slash.'),
  root: z
    .string()
    .optional()
    .describe('Optional folder (inside a granted root) to search instead of all granted roots.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of paths to return (default 50).'),
});

interface SearchArgs {
  pattern: string;
  root?: string;
  limit?: number;
}

type FindArgs = z.infer<typeof findSchema>;

export const findFilesTool: NativeToolDefinition<FindArgs> = {
  name: 'find_files',
  description:
    'Find files by name inside the folders the user granted. Returns absolute paths you can pass to read_file. Common dependency folders (node_modules, .git, dist…) are skipped.',
  schema: findSchema,
  risk: 'read-only',
  category: 'files',
  pathArgs: ['root'],
  timeoutMs: 15_000,
  resultCharCap: 8_000,
  summarize: (args) => `Find files matching ${args.pattern}`,
  async exec(args, ctx) {
    const rootsOrError = resolveSearchRoots(args, ctx);
    if (typeof rootsOrError === 'string') {
      return rootsOrError;
    }
    const limit = Math.min(200, Math.max(1, Math.round(args.limit ?? 50)));
    const regex = globToRegex(args.pattern);
    const globHasSlash = args.pattern.includes('/');
    const budget = newBudget();
    const matches: string[] = [];
    for (const root of rootsOrError) {
      await walkRoot(root, (absolute, relativePath) => {
        if (matches.length < limit && matchesGlob(relativePath, regex, globHasSlash)) {
          matches.push(absolute);
        }
      }, budget);
      if (budget.truncated) {
        break;
      }
    }
    if (matches.length === 0) {
      return budget.truncated
        ? `No matches for '${args.pattern}' (search stopped early: too many files). Try a narrower pattern or root.`
        : `No matches for '${args.pattern}'.`;
    }
    const header = `${matches.length} match(es) for '${args.pattern}':`;
    const lines = [header, ...matches];
    if (budget.truncated) {
      lines.push('(search stopped early: time/file budget reached — results may be incomplete)');
    }
    return lines.join('\n');
  },
};

const grepSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe('Regular expression to search for inside file contents.'),
  root: z
    .string()
    .optional()
    .describe('Optional folder (inside a granted root) to search instead of all granted roots.'),
  glob: z
    .string()
    .optional()
    .describe('Only search files whose name matches this glob, e.g. "*.md" or "*.py".'),
  caseSensitive: z
    .boolean()
    .optional()
    .describe('Match case exactly (default false).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of matching lines to return (default 80).'),
});

type GrepArgs = z.infer<typeof grepSchema>;

export const grepFilesTool: NativeToolDefinition<GrepArgs> = {
  name: 'grep_files',
  description:
    'Search file contents inside the folders the user granted with a regular expression. Returns path:line: text matches. Binary files and dependency folders (node_modules, .git, dist…) are skipped.',
  schema: grepSchema,
  risk: 'read-only',
  category: 'files',
  pathArgs: ['root'],
  timeoutMs: 15_000,
  resultCharCap: 12_000,
  summarize: (args) => `Grep /${args.pattern}/`,
  async exec(args, ctx) {
    const rootsOrError = resolveSearchRoots(args, ctx);
    if (typeof rootsOrError === 'string') {
      return rootsOrError;
    }
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern, args.caseSensitive ? '' : 'i');
    } catch (error) {
      return `Error: invalid regular expression (${((error as Error).message ?? '').slice(0, 120)}).`;
    }
    const limit = Math.min(200, Math.max(1, Math.round(args.limit ?? 80)));
    const fileRegex = args.glob ? globToRegex(args.glob) : null;
    const globHasSlash = Boolean(args.glob && args.glob.includes('/'));
    const budget = newBudget();
    const lines: string[] = [];
    let matchCount = 0;
    for (const root of rootsOrError) {
      await walkRoot(root, async (absolute, relativePath) => {
        if (matchCount >= limit) {
          return;
        }
        if (fileRegex && !matchesGlob(relativePath, fileRegex, globHasSlash)) {
          return;
        }
        const info = await stat(absolute).catch(() => null);
        if (!info || info.size > GREP_MAX_FILE_BYTES) {
          return;
        }
        const buffer = await readFile(absolute).catch(() => null);
        if (!buffer || buffer.subarray(0, 8000).includes(0)) {
          return;
        }
        const content = buffer.toString('utf-8');
        let fileMatches = 0;
        for (const [index, line] of content.split('\n').entries()) {
          if (matchCount >= limit || fileMatches >= GREP_MAX_MATCHES_PER_FILE) {
            break;
          }
          if (regex.test(line)) {
            matchCount += 1;
            fileMatches += 1;
            lines.push(`${absolute}:${index + 1}: ${line.trim().slice(0, GREP_LINE_CHAR_CAP)}`);
          }
        }
      }, budget);
      if (budget.truncated || matchCount >= limit) {
        break;
      }
    }
    if (matchCount === 0) {
      return budget.truncated
        ? `No matches for /${args.pattern}/ (search stopped early: too many files).`
        : `No matches for /${args.pattern}/.`;
    }
    const header = `${matchCount} matching line(s) for /${args.pattern}/:`;
    const out = [header, ...lines];
    if (budget.truncated) {
      out.push('(search stopped early: time/file budget reached — results may be incomplete)');
    }
    return out.join('\n');
  },
};
