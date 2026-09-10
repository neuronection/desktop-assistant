import type { z } from 'zod';
import type { ToolCategory, ToolRiskClass } from '@shared/turns';

export type { ToolRiskClass };

export type ToolResultBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'image'; source_type: 'base64'; data: string; mime_type: string };

export type ToolResult = string | ToolResultBlock[];

export interface ToolExecContext {
  signal?: AbortSignal;
  /** User-granted filesystem roots file tools may touch (main-injected). */
  grantedRoots?: string[];
}

export interface NativeToolDefinition<A extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  risk: ToolRiskClass;
  /** Functional grouping for the Tools settings (files/system/desktop/network/power). */
  category: ToolCategory;
  /** Users may edit the arguments on the desktop approval card. */
  editableArgs?: boolean;
  /**
   * Arg keys holding filesystem paths for tools confined to granted
   * roots. When such a path is outside the granted roots, the policy
   * engine raises a HITL access request instead of a hard failure.
   */
  pathArgs?: string[];
  summarize(args: A): string;
  exec(args: A, ctx: ToolExecContext): Promise<ToolResult>;
  timeoutMs?: number;
  resultCharCap?: number;
}
