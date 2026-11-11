import type { PrismaClient } from 'generated/prisma/client';
import { addColumnIfMissing } from './columns';

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "AiCall_messageId_idx" ON "AiCall"("messageId")`,
  `CREATE INDEX IF NOT EXISTS "AiCall_conversationId_idx" ON "AiCall"("conversationId")`,
] as const;

export const migration005 = {
  version: 5,
  name: 'ai-call-turn-context',
  async run(prisma: PrismaClient): Promise<void> {
    await addColumnIfMissing(prisma, 'AiCall', 'conversationId', 'TEXT');
    await addColumnIfMissing(prisma, 'AiCall', 'messageId', 'TEXT');
    for (const statement of INDEXES) {
      await prisma.$executeRawUnsafe(statement);
    }
  },
};
