import { tool } from 'langchain';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { NativeToolDefinition, ToolExecContext, ToolResult, ToolResultBlock } from './types';
import type { ToolPolicyEngine } from './policy';

export const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
export const DEFAULT_RESULT_CHAR_CAP = 20_000;
export const MAX_TOOL_NAME_LENGTH = 64;

export function truncateText(text: string, cap: number): string {
  if (text.length <= cap) {
    return text;
  }
  return `${text.slice(0, cap)}…[truncated ${text.length - cap} chars]`;
}

/** Hard cap: the result never exceeds `max` characters (family caps). */
export function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function capToolResult(result: ToolResult, cap: number): ToolResult {
  if (typeof result === 'string') {
    return truncateText(result, cap);
  }
  return result.map((block) =>
    block.type === 'text' ? { ...block, text: truncateText(block.text, cap) } : block
  );
}

export function withToolTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function imageBlockTooLarge(url: string): boolean {
  return url.startsWith('data:') && url.length > 800_000;
}

const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/;

/**
 * Model-facing wire form: the LangChain data-block shape every provider
 * package converts inside tool-role messages (plain `{ type: 'image', url }`
 * blocks pass through ChatOpenAI unconverted and are rejected with a 400).
 */
function toWireBlocks(blocks: ToolResultBlock[]): ToolResultBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'image' || !('url' in block)) {
      return block;
    }
    const match = DATA_URL_PATTERN.exec(block.url);
    if (!match) {
      return { type: 'text', text: 'Image result omitted (unsupported encoding).' };
    }
    return { type: 'image', source_type: 'base64', data: match[2], mime_type: match[1] };
  });
}

export function buildLangChainTool(
  def: NativeToolDefinition,
  baseContext: ToolExecContext = {},
  destructiveGate?: <A>(args: A, run: (args: A) => Promise<ToolResult>) => Promise<ToolResult>
): StructuredToolInterface {
  return tool(
    async (args) => {
      const ctx: ToolExecContext = { ...baseContext };
      const run = (): Promise<ToolResult> => {
        try {
          return withToolTimeout(def.exec(args as never, ctx), def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS, def.name);
        } catch (error) {
          return Promise.reject(error);
        }
      };
      try {
        const result = await (destructiveGate ? destructiveGate(args as never, run) : run());
        let capped = capToolResult(result, def.resultCharCap ?? DEFAULT_RESULT_CHAR_CAP);
        if (Array.isArray(capped)) {
          const oversize = capped.some((block) => block.type === 'image' && 'url' in block && imageBlockTooLarge(block.url));
          if (oversize) {
            const withoutImages = capped.filter(
              (block) => !(block.type === 'image' && 'url' in block && imageBlockTooLarge(block.url))
            );
            withoutImages.push({ type: 'text', text: 'Image result omitted (too large).' });
            capped = withoutImages;
          }
          return toWireBlocks(capped);
        }
        return capped;
      } catch (error) {
        return `Error (${def.name}): ${truncateText((error as Error).message ?? String(error), 500)}`;
      }
    },
    {
      name: def.name,
      description: def.description,
      schema: def.schema,
    }
  );
}

function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** Deterministic short hash of tool args for the `tool_calls` audit table. */
export function hashToolArgs(args: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(args, Object.keys(args as object ?? {}).sort());
  } catch {
    serialized = String(args);
  }
  return shortHash(serialized ?? '');
}

export function namespaceMcpTool(server: string, toolName: string): string {
  const full = `mcp__${server}__${toolName}`;
  if (full.length <= MAX_TOOL_NAME_LENGTH) {
    return full;
  }
  const suffix = `~${shortHash(full)}`;
  const budget = MAX_TOOL_NAME_LENGTH - 'mcp__'.length - '__'.length - suffix.length;
  const serverBudget = Math.max(1, Math.floor(budget / 2));
  const nameBudget = Math.max(1, budget - serverBudget);
  return `mcp__${server.slice(0, serverBudget)}__${toolName.slice(0, nameBudget)}${suffix}`;
}

export function mergeTools(
  native: StructuredToolInterface[],
  mcp: StructuredToolInterface[]
): StructuredToolInterface[] {
  const taken = new Set(native.map((t) => t.name));
  return [
    ...native,
    ...mcp.map((mcpTool) => {
      const namespaced = namespaceMcpTool('server', mcpTool.name);
      let name = namespaced;
      let n = 2;
      while (taken.has(name)) {
        name = `${namespaced.slice(0, MAX_TOOL_NAME_LENGTH - 2)}_${n}`;
        n += 1;
      }
      taken.add(name);
      if (name === mcpTool.name) {
        return mcpTool;
      }
      return tool(async (args) => mcpTool.invoke(args), {
        name,
        description: mcpTool.description,
        schema: mcpTool.schema,
      });
    }),
  ];
}

export class ToolRegistry {
  private readonly definitions = new Map<string, NativeToolDefinition>();

  register(def: NativeToolDefinition): void {
    if (this.definitions.has(def.name)) {
      throw new Error(`Tool '${def.name}' is already registered.`);
    }
    this.definitions.set(def.name, def);
  }

  list(): NativeToolDefinition[] {
    return [...this.definitions.values()];
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  definition(name: string): NativeToolDefinition | undefined {
    return this.definitions.get(name);
  }

  riskFor(name: string): NativeToolDefinition['risk'] | undefined {
    return this.definitions.get(name)?.risk;
  }

  summarizeFor(name: string, args: unknown): string {
    const def = this.definitions.get(name);
    if (!def) {
      return clampText(JSON.stringify(args) ?? name, 160);
    }
    try {
      return clampText(def.summarize(args as never), 160);
    } catch {
      return name;
    }
  }

  buildTools(policy?: ToolPolicyEngine): StructuredToolInterface[] {
    const baseContext: ToolExecContext = { grantedRoots: policy?.grantedRoots() ?? [] };
    let queue: Promise<unknown> = Promise.resolve();
    const destructiveGate = <A>(args: A, run: (args: A) => Promise<ToolResult>): Promise<ToolResult> => {
      const execution = queue.then(() => run(args));
      queue = execution.catch(() => undefined);
      return execution;
    };
    return this.list()
      .filter((def) => !policy?.isDisabled(def.name))
      .map((def) =>
        def.risk === 'destructive'
          ? buildLangChainTool(def, baseContext, destructiveGate)
          : buildLangChainTool(def, baseContext)
      );
  }

  /** Slash-command execution path: validate, timeout, cap — no model involved. */
  async executeDirect(
    name: string,
    args: unknown,
    ctx: ToolExecContext = {}
  ): Promise<{ ok: boolean; text: string; images: string[]; durationMs: number }> {
    const def = this.definitions.get(name);
    if (!def) {
      return { ok: false, text: `Unknown tool '${name}'.`, images: [], durationMs: 0 };
    }
    const parse = def.schema.safeParse(args);
    if (!parse.success) {
      return { ok: false, text: `Invalid arguments for '${name}'.`, images: [], durationMs: 0 };
    }
    const startedAt = Date.now();
    try {
      const result = await withToolTimeout(def.exec(parse.data as never, ctx), def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS, name);
      const capped = capToolResult(result, def.resultCharCap ?? DEFAULT_RESULT_CHAR_CAP);
      const images: string[] =
        typeof capped === 'string'
          ? []
          : capped.filter((block): block is Extract<ToolResultBlock, { type: 'image'; url: string }> => block.type === 'image' && 'url' in block).map((block) => block.url);
      const text =
        typeof capped === 'string'
          ? capped
          : capped
              .map((block) => (block.type === 'text' ? block.text : ''))
              .filter(Boolean)
              .join('\n');
      return { ok: true, text, images, durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        text: `Error (${name}): ${truncateText((error as Error).message ?? String(error), 500)}`,
        images: [],
        durationMs: Date.now() - startedAt,
      };
    }
  }
}
