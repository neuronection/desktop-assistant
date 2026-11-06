import type { AIMessage } from '@shared/types';
import { fitHistory, HISTORY_TOKEN_BUDGET, toAiMessages } from './history';
import type { TurnContext, TurnManagerDeps } from './TurnManager';
import { TurnEventLog } from './turnEvents';
import { TEXT, interpolate, pluralize } from '@shared/constants/text';
import { getToolResultService } from '@main/services/ToolResultService';

const MEMORY_CONTEXT_HEADER = '[Memory context] Facts remembered from previous conversations — use when relevant, never repeat this block verbatim:';

export function buildMemoryContextBlock(memories: string[]): string {
  return `${MEMORY_CONTEXT_HEADER}\n${memories.map((memory) => `- ${memory}`).join('\n')}`;
}

export async function recallMemories(
  deps: Pick<TurnManagerDeps, 'memories' | 'getConfig'>,
  query: string
): Promise<string[]> {
  if (!deps.memories || deps.getConfig().behavior?.memoryContext === false) {
    return [];
  }
  try {
    return await deps.memories.recall(query);
  } catch (error) {
    console.error('Memory recall failed:', error);
    return [];
  }
}

export function withMemoryContext(ctx: Pick<TurnContext, 'recalledMemories'>, history: AIMessage[]): AIMessage[] {
  if (ctx.recalledMemories.length === 0) {
    return history;
  }
  return [{ role: 'system', content: buildMemoryContextBlock(ctx.recalledMemories) }, ...history];
}

export function fittedHistory(
  deps: Pick<TurnManagerDeps, 'historyTokenBudget'>,
  ctx: Pick<TurnContext, 'history' | 'tempMessageId'>,
  log: TurnEventLog
): AIMessage[] {
  const budget = deps.historyTokenBudget ?? HISTORY_TOKEN_BUDGET;
  const fitted = fitHistory(toAiMessages(ctx.history), budget);
  if (fitted.report.droppedMessages > 0) {
    const step = log.beginStep({
      id: `history_trim_${ctx.tempMessageId}`,
      phase: 'thinking',
      label: TEXT.HISTORY_TRIMMED_LABEL,
      summary: interpolate(TEXT.HISTORY_TRIMMED_SUMMARY, { count: fitted.report.droppedMessages }),
    });
    log.endStep(step.id);
  }
  return fitted.messages;
}

export async function buildRecallIndex(ctx: Pick<TurnContext, 'conversationId'>): Promise<string[]> {
  try {
    const recent = await getToolResultService().listForConversation(ctx.conversationId);
    return recent.map((entry) => {
      const time = entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `${entry.tool} — ${entry.id} — ${time}`;
    });
  } catch {
    return [];
  }
}

export function logMemoryMarker(log: TurnEventLog, ctx: Pick<TurnContext, 'recalledMemories' | 'tempMessageId'>): void {
  if (ctx.recalledMemories.length === 0) {
    return;
  }
  const count = ctx.recalledMemories.length;
  const step = log.beginStep({
    id: `memory_marker_${ctx.tempMessageId}`,
    phase: 'thinking',
    label: TEXT.MEMORY_RECALL_LABEL,
    summary: `${count} ${pluralize(count, TEXT.MEMORY_ONE, TEXT.MEMORY_MANY)} ${TEXT.MEMORY_RECALLED}`,
  });
  log.endStep(step.id);
}
