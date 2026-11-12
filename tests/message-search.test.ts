import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from 'generated/prisma/client';
import { MessageService } from '@main/services/MessageService';
import type { DatabaseService } from '@main/services/DatabaseService';
import type { ConversationService } from '@main/services/ConversationService';

function makeService(client: Record<string, unknown>): MessageService {
  return new MessageService(
    { getClient: () => client } as unknown as DatabaseService,
    {} as ConversationService
  );
}

describe('MessageService.searchMessages', () => {
  it('returns ranked FTS hits without plaintext logging', async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: 'm1',
        conversationId: 'c1',
        title: 'Cats',
        role: 'user',
        snippet: 'my cat is…',
        createdAt: '2026-11-11T10:00:00.000Z',
      },
    ]);
    const service = makeService({ $executeRawUnsafe: vi.fn(async () => undefined), $queryRawUnsafe: queryRaw });
    const hits = await service.searchMessages('cat');
    expect(hits).toEqual([
      {
        id: 'm1',
        conversationId: 'c1',
        conversationTitle: 'Cats',
        role: 'user',
        snippet: 'my cat is…',
        createdAt: '2026-11-11T10:00:00.000Z',
      },
    ]);
    expect(queryRaw.mock.calls[0]?.[1]).toBe('"cat"*');
  });

  it('falls back to a like scan when FTS fails', async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: 'm2',
        conversationId: 'c2',
        title: 'Fallback',
        role: 'assistant',
        content: 'fallback content',
        createdAt: '2026-11-11T11:00:00.000Z',
      },
    ]);
    const service = makeService({
      $executeRawUnsafe: vi.fn(async () => {
        throw new Error('no fts');
      }),
      $queryRawUnsafe: queryRaw,
    });
    const hits = await service.searchMessages('fallback');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: 'm2', conversationTitle: 'Fallback', snippet: 'fallback content' });
    expect(String(queryRaw.mock.calls[0]?.[0])).toContain('instr(lower');
  });

  it('returns nothing for an empty query', async () => {
    const service = makeService({});
    expect(await service.searchMessages('   ')).toEqual([]);
  });
});
