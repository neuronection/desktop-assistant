import type { PrismaClient } from 'generated/prisma/client';
import type { ToolUsageStats, ToolUsageRow, AppUsageStats, AppUsageRow } from '@shared/toolUsage';

export type { ToolUsageStats, ToolUsageRow, AppUsageStats, AppUsageRow };
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

export interface AiCallRecord {
  task: string;
  providerId?: string;
  model: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  error?: string;
}

export type AuditSink = (record: AiCallRecord) => Promise<void>;

export type ToolCallOutcome = 'ok' | 'error' | 'denied';

export type ToolApprovalSource = 'auto' | 'once' | 'session' | 'always' | 'policy' | 'denied' | 'timeout';

export interface ToolCallRecord {
  tool: string;
  argsHash: string;
  outcome: ToolCallOutcome;
  durationMs: number;
  approvedBy: ToolApprovalSource;
  conversationId?: string;
  messageId?: string;
  mcpServer?: string | null;
}

export type ToolCallAuditSink = (record: ToolCallRecord) => Promise<void>;

type ClientProvider = () => PrismaClient | null;

let clientProvider: ClientProvider = () => null;

export function setAiAuditClientProvider(provider: ClientProvider): void {
  clientProvider = provider;
}

const dbSink: AuditSink = async (record) => {
  try {
    const client = clientProvider();
    if (!client) {
      return;
    }
    await client.aiCall.create({
      data: {
        task: record.task,
        providerId: record.providerId ?? null,
        model: record.model,
        durationMs: record.durationMs,
        outcome: record.outcome,
        error: record.error ?? null,
      },
    });
  } catch (error) {
    console.error('AI audit write failed (call still proceeds):', error);
  }
};

let sink: AuditSink = dbSink;

export function setAuditSink(replacement: AuditSink): void {
  sink = replacement;
}

export async function recordAiCall(record: AiCallRecord): Promise<void> {
  await sink(record);
}

const dbToolCallSink: ToolCallAuditSink = async (record) => {
  try {
    const client = clientProvider();
    if (!client) {
      return;
    }
    await client.toolCall.create({
      data: {
        tool: record.tool,
        argsHash: record.argsHash,
        outcome: record.outcome,
        durationMs: record.durationMs,
        approvedBy: record.approvedBy,
        conversationId: record.conversationId ?? null,
        messageId: record.messageId ?? null,
        mcpServer: record.mcpServer ?? null,
      },
    });
  } catch (error) {
    console.error('Tool-call audit write failed (call still proceeds):', error);
  }
};

let toolCallSink: ToolCallAuditSink = dbToolCallSink;

export function setToolCallAuditSink(replacement: ToolCallAuditSink): void {
  toolCallSink = replacement;
}

export async function recordToolCall(record: ToolCallRecord): Promise<void> {
  await toolCallSink(record);
}

export interface AiCallAuditMeta {
  task: string;
  providerId: string;
  model: string;
}

/**
 * LangChain callback handler that records every LLM call inside an agent
 * loop to the `ai_calls` audit table — the agent never bypasses the
 * audit funnel (ai-features §9).
 */
export function createAiCallAuditHandler(meta: AiCallAuditMeta): BaseCallbackHandler {
  const startedAt = new Map<string, number>();

  class Handler extends BaseCallbackHandler {
    name = 'ai_calls_audit';

    handleLLMStart(_llm: unknown, _prompts: unknown, runId: string): void {
      startedAt.set(runId, Date.now());
    }

    async handleLLMEnd(_output: unknown, runId: string): Promise<void> {
      const started = startedAt.get(runId);
      startedAt.delete(runId);
      await recordAiCall({
        task: meta.task,
        providerId: meta.providerId,
        model: meta.model,
        durationMs: started ? Date.now() - started : 0,
        outcome: 'ok',
      });
    }

    async handleLLMError(error: unknown, runId: string): Promise<void> {
      const started = startedAt.get(runId);
      startedAt.delete(runId);
      await recordAiCall({
        task: meta.task,
        providerId: meta.providerId,
        model: meta.model,
        durationMs: started ? Date.now() - started : 0,
        outcome: 'error',
        error: String((error as Error)?.message ?? error).slice(0, 500),
      });
    }
  }

  return new Handler();
}

/**
 * Read-only aggregation over the `tool_calls` audit table (plan 12 §7):
 * per-tool counts, approval ratios, denials, average durations and
 * recent failures — args stay hashed (no PII beyond the audit).
 */
export async function getToolUsageStats(windowDays: number | null): Promise<ToolUsageStats> {
  const client = clientProvider();
  if (!client) {
    return { windowDays, total: 0, rows: [], recentFailures: [] };
  }
  const since = windowDays !== null ? new Date(Date.now() - windowDays * 86_400_000) : null;
  const where = since ? { createdAt: { gte: since } } : {};
  const rows = await client.toolCall.findMany({
    where,
    select: { tool: true, outcome: true, approvedBy: true, durationMs: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const byTool = new Map<
    string,
    { total: number; ok: number; errors: number; denied: number; approvals: Map<string, number>; duration: number; lastUsedAt: Date }
  >();
  for (const row of rows) {
    let entry = byTool.get(row.tool);
    if (!entry) {
      entry = { total: 0, ok: 0, errors: 0, denied: 0, approvals: new Map(), duration: 0, lastUsedAt: row.createdAt };
      byTool.set(row.tool, entry);
    }
    entry.total += 1;
    entry.duration += row.durationMs;
    if (row.createdAt > entry.lastUsedAt) {
      entry.lastUsedAt = row.createdAt;
    }
    if (row.outcome === 'ok') {
      entry.ok += 1;
    } else if (row.outcome === 'error') {
      entry.errors += 1;
    } else if (row.outcome === 'denied') {
      entry.denied += 1;
    }
    entry.approvals.set(row.approvedBy, (entry.approvals.get(row.approvedBy) ?? 0) + 1);
  }

  const usageRows: ToolUsageRow[] = [...byTool.entries()]
    .map(([tool, entry]) => ({
      tool,
      total: entry.total,
      ok: entry.ok,
      errors: entry.errors,
      denied: entry.denied,
      approvals: Object.fromEntries([...entry.approvals.entries()].sort()),
      avgDurationMs: Math.round(entry.duration / Math.max(1, entry.total)),
      lastUsedAt: entry.lastUsedAt.toISOString(),
    }))
    .sort((a, b) => b.total - a.total);

  const recentFailures = rows
    .filter((row) => row.outcome !== 'ok')
    .slice(0, 10)
    .map((row) => ({
      tool: row.tool,
      outcome: row.outcome,
      approvedBy: row.approvedBy,
      at: row.createdAt.toISOString(),
    }));

  return { windowDays, total: rows.length, rows: usageRows, recentFailures };
}

export type AppAttribution = (tool: string, mcpServer: string | null) => string | null;

/**
 * Per-app aggregates over the same `tool_calls` audit (plan-15 polish):
 * rows are attributed to tool apps via the injected resolver; calls the
 * app cannot claim (plain native/command tools) are excluded.
 */
export async function getAppUsageStats(windowDays: number | null, resolveApp: AppAttribution): Promise<AppUsageStats> {
  const client = clientProvider();
  if (!client) {
    return { windowDays, total: 0, rows: [] };
  }
  const since = windowDays !== null ? new Date(Date.now() - windowDays * 86_400_000) : null;
  const rows = await client.toolCall.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    select: { tool: true, outcome: true, durationMs: true, mcpServer: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const byApp = new Map<
    string,
    { total: number; ok: number; errors: number; denied: number; duration: number; lastUsedAt: Date }
  >();
  for (const row of rows) {
    const app = resolveApp(row.tool, row.mcpServer ?? null);
    if (!app) {
      continue;
    }
    let entry = byApp.get(app);
    if (!entry) {
      entry = { total: 0, ok: 0, errors: 0, denied: 0, duration: 0, lastUsedAt: row.createdAt };
      byApp.set(app, entry);
    }
    entry.total += 1;
    entry.duration += row.durationMs;
    if (row.createdAt > entry.lastUsedAt) {
      entry.lastUsedAt = row.createdAt;
    }
    if (row.outcome === 'ok') {
      entry.ok += 1;
    } else if (row.outcome === 'error') {
      entry.errors += 1;
    } else if (row.outcome === 'denied') {
      entry.denied += 1;
    }
  }

  const usageRows: AppUsageRow[] = [...byApp.entries()]
    .map(([app, entry]) => ({
      app,
      total: entry.total,
      ok: entry.ok,
      errors: entry.errors,
      denied: entry.denied,
      avgDurationMs: Math.round(entry.duration / Math.max(1, entry.total)),
      lastUsedAt: entry.lastUsedAt.toISOString(),
    }))
    .sort((a, b) => b.total - a.total);

  const attributed = usageRows.reduce((sum, row) => sum + row.total, 0);
  return { windowDays, total: attributed, rows: usageRows };
}

export interface GraphNodeRunRecord {
  flow: string;
  threadId: string;
  node: string;
  outcome: 'done' | 'failed' | 'interrupted';
  durationMs: number;
  resumed: boolean;
}

/** Persists one finished graph-node execution (plan 13 S5). Fire-and-forget safe. */
export async function recordGraphNodeRun(record: GraphNodeRunRecord): Promise<void> {
  try {
    const client = clientProvider();
    if (!client) {
      return;
    }
    await client.graphNodeRun.create({
      data: {
        flow: record.flow,
        threadId: record.threadId,
        node: record.node,
        outcome: record.outcome,
        durationMs: record.durationMs,
        resumed: record.resumed,
      },
    });
  } catch (error) {
    console.error('Graph node run write failed:', error);
  }
}

const GRAPH_NODE_RUN_PRUNE_MAX_AGE_MS = 7 * 86_400_000;

/** Rides the checkpointer's boot prune (plan 13 S5). */
export async function pruneGraphNodeRuns(maxAgeMs: number = GRAPH_NODE_RUN_PRUNE_MAX_AGE_MS): Promise<void> {
  try {
    const client = clientProvider();
    if (!client) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeMs);
    await client.graphNodeRun.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch (error) {
    console.error('Graph node run prune failed:', error);
  }
}

export interface GraphNodeRunStats {
  node: string;
  runs: number;
  failed: number;
  interrupted: number;
  resumed: number;
  avgDurationMs: number;
}

/** Dashboard-ready aggregation (plan-12 §7 consumer) — read-only, hashed semantics. */
export async function getGraphNodeRunStats(flow: string, windowDays: number | null = 7): Promise<GraphNodeRunStats[]> {
  const client = clientProvider();
  if (!client) {
    return [];
  }
  const since = windowDays !== null ? new Date(Date.now() - windowDays * 86_400_000) : new Date(0);
  const rows = await client.graphNodeRun.findMany({
    where: { flow, createdAt: { gte: since } },
    select: { node: true, outcome: true, durationMs: true, resumed: true },
  });
  const byNode = new Map<string, { runs: number; failed: number; interrupted: number; resumed: number; duration: number }>();
  for (const row of rows) {
    let entry = byNode.get(row.node);
    if (!entry) {
      entry = { runs: 0, failed: 0, interrupted: 0, resumed: 0, duration: 0 };
      byNode.set(row.node, entry);
    }
    entry.runs += 1;
    entry.duration += row.durationMs;
    if (row.outcome === 'failed') entry.failed += 1;
    if (row.outcome === 'interrupted') entry.interrupted += 1;
    if (row.resumed) entry.resumed += 1;
  }
  return [...byNode.entries()]
    .map(([node, entry]) => ({
      node,
      runs: entry.runs,
      failed: entry.failed,
      interrupted: entry.interrupted,
      resumed: entry.resumed,
      avgDurationMs: Math.round(entry.duration / Math.max(1, entry.runs)),
    }))
    .sort((a, b) => b.runs - a.runs);
}
