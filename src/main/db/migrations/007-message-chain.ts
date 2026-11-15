import type { PrismaClient } from 'generated/prisma/client';

interface RootRow {
  conversationId: string;
  id: string;
}

/**
 * Pre-branching conversations have every message as a root (`parentId` NULL)
 * and no `activeRootId`, so the visible-path walk starts at the newest root
 * and shows one message. Chain each conversation's roots in creation order
 * and point the conversation at the head of that chain.
 *
 * Idempotent: a repaired conversation has exactly one root, so the scan finds
 * nothing on a second run. Fresh profiles never run it (they boot at head).
 */
export const migration007 = {
  version: 7,
  name: 'message-chain-backfill',
  notes: {
    'Message(parentId IS NULL, conversationId)':
      'one scan per lift: finds conversations whose roots are still flat (legacy pre-branching rows); repairing them keeps the set empty afterwards',
  },
  async run(prisma: PrismaClient): Promise<void> {
    const roots = await prisma.$queryRawUnsafe<RootRow[]>(
      `SELECT "conversationId", "id" FROM "Message"
        WHERE "parentId" IS NULL
          AND "conversationId" IN (
            SELECT "conversationId" FROM "Message"
             WHERE "parentId" IS NULL
             GROUP BY "conversationId"
            HAVING COUNT(*) > 1
          )
        ORDER BY "conversationId", "createdAt", rowid`
    );

    const byConversation = new Map<string, string[]>();
    for (const row of roots) {
      const chain = byConversation.get(row.conversationId) ?? [];
      chain.push(row.id);
      byConversation.set(row.conversationId, chain);
    }

    for (const [conversationId, chain] of byConversation) {
      for (let index = 0; index < chain.length; index += 1) {
        const parentId = index === 0 ? null : chain[index - 1];
        const activeChildId = index + 1 < chain.length ? chain[index + 1] : null;
        await prisma.$executeRawUnsafe(
          `UPDATE "Message" SET "parentId" = ?, "activeChildId" = ? WHERE "id" = ?`,
          parentId,
          activeChildId,
          chain[index]
        );
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "Conversation" SET "activeRootId" = ? WHERE "id" = ?`,
        chain[0],
        conversationId
      );
    }
  },
};
