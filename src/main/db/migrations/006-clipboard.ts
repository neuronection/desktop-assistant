import type { PrismaClient } from 'generated/prisma/client';

const TABLE = `CREATE TABLE IF NOT EXISTS "ClipboardEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ciphertext" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const INDEXES = [`CREATE INDEX IF NOT EXISTS "ClipboardEntry_createdAt_idx" ON "ClipboardEntry"("createdAt")`] as const;

export const migration006 = {
  version: 6,
  name: 'clipboard-history',
  async run(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRawUnsafe(TABLE);
    for (const statement of INDEXES) {
      await prisma.$executeRawUnsafe(statement);
    }
  },
};
