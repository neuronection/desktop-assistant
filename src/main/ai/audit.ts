import type { PrismaClient } from 'generated/client';
import type { ToolUsageStats, ToolUsageRow } from '@shared/toolUsage';

export type { ToolUsageStats, ToolUsageRow };
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
