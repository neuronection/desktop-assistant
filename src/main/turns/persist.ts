import { MessageRole } from '@shared/database-types';
import type { TurnMetadata } from '@shared/turns';
import type { TurnContext, TurnManagerDeps } from './TurnManager';

const TRACE_STEP_CAP = 12;

export function capTraceSteps(steps: TurnMetadata['steps']): TurnMetadata['steps'] {
  if (!steps) {
    return steps;
  }
  return steps
    .map((step) =>
      step.summary && step.summary.length > 160 ? { ...step, summary: `${step.summary.slice(0, 159)}…` } : step
    )
    .slice(0, TRACE_STEP_CAP);
}

export async function persistTurn(
  deps: Pick<TurnManagerDeps, 'messages'>,
  ctx: Pick<TurnContext, 'conversationId' | 'decision' | 'userMessageId' | 'branchedFrom' | 'request'>,
  data: { content: string; error?: string; metadata: TurnMetadata }
): Promise<void> {
  if (!data.content && !data.error) {
    return;
  }
  const metadata: TurnMetadata = {
    ...data.metadata,
    steps: capTraceSteps(data.metadata.steps),
    ...(ctx.decision ? { decision: ctx.decision } : {}),
    ...(ctx.branchedFrom ? { branchedFrom: ctx.branchedFrom } : {}),
  };
  try {
    await deps.messages.createMessage(
      data.content,
      MessageRole.ASSISTANT,
      ctx.conversationId,
      undefined,
      data.error,
      metadata,
      { parentId: ctx.userMessageId, activate: ctx.request.branch?.kind === 'regenerate' ? 'always' : 'if-tip' }
    );
  } catch (error) {
    console.error('Failed to persist assistant message:', error);
  }
}
