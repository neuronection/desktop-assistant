import type { PrismaClient } from 'generated/prisma/client';
import type { RetentionSettings } from '@shared/types';
import { checkpointThreadOwner } from '@main/turns/branchThreads';

export interface RetentionPruneDeps {
  client: PrismaClient;
  retention: RetentionSettings;
  /** Tool-result rows also own files; the service deletes both. */
  pruneToolResults?: (maxAgeMs: number) => Promise<void>;
  now?: () => number;
}

export interface RetentionPruneResult {
  checkpoints: number;
  graphNodeRuns: number;
  notifications: number;
  aiCalls: number;
  toolCalls: number;
  commandInvocations: number;
  toolResults: number;
}

const DAY_MS = 86_400_000;

function cutoff(now: number, days: number | null): Date | null {
  if (days === null || !Number.isFinite(days) || days <= 0) {
    return null;
  }
  return new Date(now - days * DAY_MS);
}

/**
 * The one boot prune pass (plan 36 D6). Every window is explicit in
 * `behavior.retention`; a null window keeps all rows. Each table fails
 * soft so one bad query never blocks the rest of the boot.
 */
export async function runRetentionPrune(deps: RetentionPruneDeps): Promise<RetentionPruneResult> {
  const now = deps.now?.() ?? Date.now();
  const result: RetentionPruneResult = {
    checkpoints: 0,
    graphNodeRuns: 0,
    notifications: 0,
    aiCalls: 0,
    toolCalls: 0,
    commandInvocations: 0,
    toolResults: 0,
  };

  const prune = async (table: keyof RetentionPruneResult, days: number | null, run: (before: Date) => Promise<number>): Promise<void> => {
    const before = cutoff(now, days);
    if (!before) {
      return;
    }
    try {
      result[table] = await run(before);
    } catch (error) {
      console.error(`Retention prune failed for ${table}:`, error);
    }
  };

  await prune('checkpoints', deps.retention.checkpointsDays, async (before) => {
    // Thread ownership covers both forms: bare `{conversationId}` and
    // `{conversationId}:{branchTipId}`. A thread follows its conversation's
    // age, and an owner-less thread is an orphan.
    const [threads, conversations] = await Promise.all([
      deps.client.checkpoint.findMany({ select: { threadId: true, createdAt: true } }),
      deps.client.conversation.findMany({ select: { id: true, updatedAt: true } }),
    ]);
    const owners = new Map(conversations.map((conversation) => [conversation.id, conversation.updatedAt]));
    const stale = new Set<string>();
    for (const thread of threads) {
      const owner = owners.get(checkpointThreadOwner(thread.threadId));
      if (!owner || owner < before) {
        stale.add(thread.threadId);
      }
    }
    const ids = [...stale];
    const staleThreads = ids.length > 0 ? [{ threadId: { in: ids } }] : [];
    const where = { OR: [...staleThreads, { createdAt: { lt: before } }] };
    const writes = await deps.client.checkpointWrite.deleteMany({ where });
    const checkpoints = await deps.client.checkpoint.deleteMany({ where });
    return writes.count + checkpoints.count;
  });
  await prune('graphNodeRuns', deps.retention.graphNodeRunsDays, async (before) => {
    const rows = await deps.client.graphNodeRun.deleteMany({ where: { createdAt: { lt: before } } });
    return rows.count;
  });
  await prune('notifications', deps.retention.notificationsDays, async (before) => {
    const rows = await deps.client.notification.deleteMany({ where: { createdAt: { lt: before } } });
    return rows.count;
  });
  await prune('aiCalls', deps.retention.aiCallsDays, async (before) => {
    const rows = await deps.client.aiCall.deleteMany({ where: { createdAt: { lt: before } } });
    return rows.count;
  });
  await prune('toolCalls', deps.retention.toolCallsDays, async (before) => {
    const rows = await deps.client.toolCall.deleteMany({ where: { createdAt: { lt: before } } });
    return rows.count;
  });
  await prune('commandInvocations', deps.retention.commandInvocationsDays, async (before) => {
    const rows = await deps.client.commandInvocation.deleteMany({ where: { createdAt: { lt: before } } });
    return rows.count;
  });

  const toolResultsDays = deps.retention.toolResultsDays;
  const toolResultsBefore = cutoff(now, toolResultsDays);
  if (toolResultsBefore && deps.pruneToolResults) {
    try {
      await deps.pruneToolResults(now - toolResultsBefore.getTime());
      result.toolResults = 1;
    } catch (error) {
      console.error('Retention prune failed for toolResults:', error);
    }
  }

  return result;
}
