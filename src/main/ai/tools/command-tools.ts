import { z } from 'zod';
import { tool } from 'langchain';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { CommandArgSpec, CommandEntry } from '@shared/commands';
import type { ToolRiskClass } from '@shared/turns';

export interface AgentCommandSource {
  /** Bridgeable, agent-scoped entries (plan 14 D9 filter already applied). */
  getAgentEntries(): CommandEntry[];
  /** Executes through CommandService — records history with source 'agent'. */
  executeAgent(entryId: string, argv: string[]): Promise<{ ok: boolean; text: string }>;
}

export interface WrappedCommandTool {
  name: string;
  tool: StructuredToolInterface;
  risk: ToolRiskClass;
}

const MAX_COMMAND_ARGS = 8;

/** Command ids (`app:firefox`, `integration:acme:deploy`) → tool-safe slugs. */
export function commandToolSlug(entryId: string): string {
  return `command_${entryId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function zodForArg(spec: CommandArgSpec): z.ZodTypeAny {
  let base: z.ZodTypeAny =
    spec.type === 'number' ? z.number() : spec.type === 'boolean' ? z.boolean() : z.string();
  if (spec.enumValues && spec.enumValues.length > 0) {
    base = z.enum(spec.enumValues as [string, ...string[]]);
  }
  if (spec.description) {
    base = base.describe(spec.description);
  }
  return spec.required ? base : base.optional();
}

export function schemaFromArgs(args: CommandArgSpec[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of args.slice(0, MAX_COMMAND_ARGS)) {
    shape[spec.name] = zodForArg(spec);
  }
  return z.object(shape).describe('Arguments for the command.');
}

export function describeCommand(entry: CommandEntry): string {
  const parts = [entry.title];
  if (entry.subtitle) {
    parts.push(entry.subtitle);
  }
  if (entry.args.length > 0) {
    const argDocs = entry.args
      .map((spec) => `${spec.name}${spec.required ? '' : ' (optional)'}${spec.description ? `: ${spec.description}` : ''}`)
      .join('; ');
    parts.push(`Arguments — ${argDocs}.`);
  }
  return parts.join(' — ');
}

/** Maps the agent's named arguments onto the command's positional argv. */
export function argvForEntry(entry: CommandEntry, args: Record<string, unknown>): string[] {
  return entry.args.map((spec) => {
    const value = args[spec.name];
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  });
}

/**
 * Risk mapping (D9): bridged commands use their catalog risk when the
 * assembler resolved one (custom wrappers inherit their bound tool);
 * everything else defaults to state-changing.
 */
export function buildCommandTools(source: AgentCommandSource): WrappedCommandTool[] {
  return source.getAgentEntries().map((entry) => {
    const name = commandToolSlug(entry.id);
    const schema = schemaFromArgs(entry.args);
    const wrapped = tool(
      async (args: Record<string, unknown>) => {
        const outcome = await source.executeAgent(entry.id, argvForEntry(entry, args));
        return outcome.ok ? outcome.text : `Error (${name}): ${outcome.text}`;
      },
      {
        name,
        description: describeCommand(entry),
        schema,
      }
    );
    return { name, tool: wrapped, risk: entry.risk ?? 'state-changing' };
  });
}
