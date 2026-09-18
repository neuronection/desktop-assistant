import { z } from 'zod';
import type { DecisionToolSchema } from '@shared/ai/decisions';
import type { ToolParameterInfo } from '@shared/turns';
import type { NativeToolDefinition } from '../tools/types';

export interface DecisionMcpToolSnapshot {
  name: string;
  description: string;
  parameterList?: ToolParameterInfo[];
}

export interface DecisionToolSurfaceInput {
  native: NativeToolDefinition[];
  mcp?: DecisionMcpToolSnapshot[];
}

export const DECISION_TOOL_CAP = 40;
const DECISION_DESCRIPTION_CAP = 240;

function capDescription(text: string | undefined): string {
  const clean = (text ?? '').trim();
  if (!clean) {
    return '';
  }
  return clean.length > DECISION_DESCRIPTION_CAP ? `${clean.slice(0, DECISION_DESCRIPTION_CAP - 1)}…` : clean;
}

function nativeParameters(def: NativeToolDefinition): Record<string, unknown> | undefined {
  try {
    return z.toJSONSchema(def.schema) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** MCP tools carry a flat parameter list — shape a minimal JSON schema from it. */
export function mcpParameterSchema(list: ToolParameterInfo[] | undefined): Record<string, unknown> | undefined {
  if (!list || list.length === 0) {
    return undefined;
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of list) {
    properties[param.name] = {
      type: param.type,
      ...(param.description ? { description: param.description } : {}),
      ...(param.enumValues?.length ? { enum: param.enumValues } : {}),
    };
    if (param.required) {
      required.push(param.name);
    }
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) };
}

/**
 * Projects the executable tool surface (native + app MCP) into the
 * engine-neutral schema (plan 20 S3). Native zod schemas convert via
 * `z.toJSONSchema` (fail-soft: a tool with an unconvertible schema keeps
 * its name/description and loses parameters); the list is capped so a
 * 100-tool registry cannot blow the engine prompt.
 */
export function decisionToolSurface(input: DecisionToolSurfaceInput): DecisionToolSchema[] {
  const surface: DecisionToolSchema[] = [];
  for (const def of input.native) {
    if (surface.length >= DECISION_TOOL_CAP) {
      return surface;
    }
    const description = capDescription(def.description);
    const parameters = nativeParameters(def);
    surface.push({ name: def.name, description, ...(parameters ? { parameters } : {}) });
  }
  for (const tool of input.mcp ?? []) {
    if (surface.length >= DECISION_TOOL_CAP) {
      break;
    }
    const description = capDescription(tool.description);
    const parameters = mcpParameterSchema(tool.parameterList);
    surface.push({
      name: tool.name,
      description,
      ...(parameters ? { parameters } : {}),
    });
  }
  return surface;
}
