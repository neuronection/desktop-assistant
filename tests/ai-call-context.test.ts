import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from 'generated/prisma/client';
import { recordAiCall, setAiAuditClientProvider } from '@main/ai/audit';
import { enterTurnContext, runWithTurnContext } from '@main/ai/turn-context';

describe('AiCall turn context', () => {
  it('writes the conversation and assistant message id inside a turn', async () => {
    const create = vi.fn(async () => ({}));
    setAiAuditClientProvider(() => ({ aiCall: { create } }) as unknown as PrismaClient);
    await runWithTurnContext({ conversationId: 'conv-1', messageId: 'msg-1' }, () =>
      recordAiCall({ task: 'chat', model: 'm', durationMs: 1, outcome: 'ok', inputTokens: 1, outputTokens: 1 })
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'conv-1', messageId: 'msg-1' }),
    });
    setAiAuditClientProvider(() => null);
  });

  it('carries the context through enterTurnContext (pre-dispatch calls)', async () => {
    const create = vi.fn(async () => ({}));
    setAiAuditClientProvider(() => ({ aiCall: { create } }) as unknown as PrismaClient);
    enterTurnContext({ conversationId: 'conv-2', messageId: 'msg-2' });
    await Promise.resolve();
    await recordAiCall({ task: 'decision', model: 'd', durationMs: 1, outcome: 'ok' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: 'conv-2', messageId: 'msg-2' }) });
    setAiAuditClientProvider(() => null);
  });
});
