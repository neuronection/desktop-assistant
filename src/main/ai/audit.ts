import type { PrismaClient } from 'generated/client';
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
