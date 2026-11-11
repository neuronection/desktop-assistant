import type { PrismaClient } from 'generated/prisma/client';
import { addColumnIfMissing } from './columns';

const COLUMNS = [
  ['AiCall', 'costMicros', 'INTEGER'],
  ['AiCall', 'usageSource', `TEXT NOT NULL DEFAULT 'unknown'`],
  ['AiCall', 'estimateMethod', 'TEXT'],
  ['AiCall', 'priceSource', 'TEXT'],
  ['AiCall', 'priceVersion', 'TEXT'],
] as const;

const INDEX = `CREATE INDEX IF NOT EXISTS "AiCall_createdAt_idx" ON "AiCall"("createdAt")`;

export const migration004 = {
  version: 4,
  name: 'ai-call-cost',
  async run(prisma: PrismaClient): Promise<void> {
    for (const [table, column, definition] of COLUMNS) {
      await addColumnIfMissing(prisma, table, column, definition);
    }
    await prisma.$executeRawUnsafe(INDEX);
  },
};
