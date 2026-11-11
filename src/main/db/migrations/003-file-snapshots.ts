import type { PrismaClient } from 'generated/prisma/client';

const TABLE = `CREATE TABLE IF NOT EXISTS "FileSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "existed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "FileSnapshot_createdAt_idx" ON "FileSnapshot"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "FileSnapshot_path_idx" ON "FileSnapshot"("path")`,
] as const;

export const migration003 = {
  version: 3,
  name: 'file-snapshots',
  async run(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRawUnsafe(TABLE);
    for (const statement of INDEXES) {
      await prisma.$executeRawUnsafe(statement);
    }
  },
};
