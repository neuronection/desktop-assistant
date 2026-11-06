import { z } from 'zod';
import type { TurnLimitKind, TurnNodeRunSummary, TurnTraceStep } from '../turns';
import type { FileArtifact } from '../artifacts';
import type { DecisionProvenance } from '../ai/decisions';
import type { MiniAppRunMessageMetadata } from '../app-pack';

export interface TurnMetadata {
  /**
   * The assistant-turn lifecycle outcome. Absent on assistant-table
   * messages that are not turns — mini-app run cards carry their state
   * in `miniAppRun.status` instead.
   */
  outcome?: 'ok' | 'failed' | 'cancelled';
  model?: string;
  durationMs?: number;
  steps?: TurnTraceStep[];
  toolCount?: number;
  nodeTimeline?: TurnNodeRunSummary[];
  artifacts?: FileArtifact[];
  limitNotice?: TurnLimitKind;
  decision?: DecisionProvenance;
  miniAppRun?: MiniAppRunMessageMetadata;
  /** Branch provenance: the message this row branched from (plan 40). */
  branchedFrom?: string;
}

const progressSchema = z
  .object({
    downloadId: z.string(),
    destination: z.string(),
    loadedBytes: z.number(),
    totalBytes: z.number().nullable(),
    status: z.enum(['active', 'done', 'cancelled', 'failed']),
  })
  .passthrough();

const traceStepSchema = z
  .object({
    id: z.string(),
    phase: z.enum(['thinking', 'tool_call', 'tool_result']),
    label: z.string(),
    toolName: z.string().optional(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
    summary: z.string().optional(),
    detail: z.unknown().optional(),
    status: z.enum(['ok', 'error']).optional(),
    response: z.string().optional(),
    hasImages: z.boolean().optional(),
    node: z.string().optional(),
    resumed: z.boolean().optional(),
    progress: progressSchema.optional(),
  })
  .passthrough();

const nodeRunSchema = z
  .object({
    node: z.string(),
    outcome: z.enum(['done', 'failed', 'interrupted']),
    durationMs: z.number(),
    resumed: z.boolean(),
    toolCount: z.number().optional(),
  })
  .passthrough();

const artifactSchema = z
  .object({
    kind: z.enum(['file', 'folder']),
    path: z.string(),
    name: z.string(),
    sizeBytes: z.number().nullable().optional(),
  })
  .passthrough();

const decisionSchema = z
  .object({
    engine: z.string(),
    confidence: z.number(),
    band: z.enum(['act', 'confirm', 'refuse']),
    reasoning: z.string().optional(),
    routedTo: z.string().optional(),
  })
  .passthrough();

const miniAppRunSchema = z
  .object({
    runId: z.string(),
    packId: z.string(),
    packTitle: z.string(),
    status: z.enum(['queued', 'running', 'paused', 'done', 'failed', 'canceled', 'interrupted']),
    rootPath: z.string(),
    totals: z
      .object({
        scanned: z.number(),
        keep: z.number(),
        ask: z.number(),
        candidate: z.number(),
        ruleDecided: z.number(),
        modelDecided: z.number(),
        cacheHits: z.number(),
        pending: z.number(),
        scanTruncated: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    estimateCalls: z.number().optional(),
    actualCalls: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const turnMetadataSchema: z.ZodType<TurnMetadata> = z
  .object({
    outcome: z.enum(['ok', 'failed', 'cancelled']).optional(),
    model: z.string().optional(),
    durationMs: z.number().optional(),
    steps: z.array(traceStepSchema).optional(),
    toolCount: z.number().optional(),
    nodeTimeline: z.array(nodeRunSchema).optional(),
    artifacts: z.array(artifactSchema).optional(),
    limitNotice: z.enum(['step-budget', 'token-budget', 'time-budget']).optional(),
    decision: decisionSchema.optional(),
    miniAppRun: miniAppRunSchema.optional(),
    branchedFrom: z.string().optional(),
  })
  .passthrough();

export function parseTurnMetadata(value: unknown): TurnMetadata | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = turnMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function validateTurnMetadata(value: unknown): TurnMetadata {
  const parsed = turnMetadataSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid turn metadata${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}
