import type { PrismaClient } from 'generated/prisma/client';
import { addColumnIfMissing } from './columns';

const TABLE = `CREATE TABLE IF NOT EXISTS "ConnectorAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "ConnectorAudit_accountId_idx" ON "ConnectorAudit"("accountId")`,
  `CREATE INDEX IF NOT EXISTS "ConnectorAudit_createdAt_idx" ON "ConnectorAudit"("createdAt")`,
] as const;

export const migration002 = {
  version: 2,
  name: 'mini-app-run-execution-and-connector-audit',
  async run(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRawUnsafe(TABLE);
    await addColumnIfMissing(prisma, 'MiniAppRun', 'execution', 'JSONB');
    for (const statement of INDEXES) {
      await prisma.$executeRawUnsafe(statement);
    }
  },
};
